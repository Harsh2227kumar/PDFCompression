const express = require('express');
const multer = require('multer');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { Queue, Worker, QueueEvents } = require('bullmq');
const Redis = require('ioredis');
const sharp = require('sharp');

const app = express();
const port = 3001;

// --- REDIS CONNECTION ---
const redisConnection = new Redis({
    maxRetriesPerRequest: null // Required for BullMQ
});

// --- BULLMQ QUEUE SETUP ---
const compressionQueue = new Queue('compression-queue', { connection: redisConnection });

// --- VERBOSE LOGGING HELPERS ---
const log = (tag, msg) => {
    console.log(`[${new Date().toISOString()}] [INFO] [${tag}] ${msg}`);
};
const logErr = (tag, msg, err = '') => {
    console.error(`[${new Date().toISOString()}] [ERROR] [${tag}] ${msg}`, err);
};

app.use(cors());
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));

// Ensure directories exist
const uploadDir = 'uploads/';
const compressedDir = 'compressed/';
[uploadDir, compressedDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const upload = multer({ 
    dest: uploadDir, 
    limits: { fileSize: 200 * 1024 * 1024 } 
});

// --- UTILS ---
function findGhostscriptCommand() {
    const configuredCommand = process.env.GHOSTSCRIPT_PATH || process.env.GS_PATH;
    if (configuredCommand) return configuredCommand;
    if (process.platform === 'win32') return 'gswin64c';
    return 'gs'; 
}

function commandExists(command, callback) {
    const probe = process.platform === 'win32' ? 'where' : 'which';
    execFile(probe, [command], (error) => {
        callback(!error);
    });
}

// --- API ROUTES ---

// 1. PDF Queue Route
app.post('/compress-pdf', upload.single('pdf'), async (req, res) => {
    log('API', 'New PDF Compression Request Received');
    if (!req.file) return res.status(400).send('No file uploaded.');

    try {
        const job = await compressionQueue.add('pdf-compression', {
            type: 'pdf',
            inputPath: req.file.path,
            originalName: req.file.originalname,
            filename: req.file.filename
        });
        
        log('QUEUE', `Job ${job.id} added for ${req.file.originalname}`);
        res.json({ jobId: job.id });
    } catch (err) {
        logErr('QUEUE_ERROR', 'Failed to add PDF job', err);
        res.status(500).send('Failed to queue compression task.');
    }
});

// 2. Image Queue Route
app.post('/compress-image', upload.single('image'), async (req, res) => {
    log('API', 'New Image Compression Request Received');
    if (!req.file) return res.status(400).send('No file uploaded.');

    try {
        const job = await compressionQueue.add('image-compression', {
            type: 'image',
            inputPath: req.file.path,
            originalName: req.file.originalname,
            filename: req.file.filename
        });

        log('QUEUE', `Job ${job.id} added for ${req.file.originalname}`);
        res.json({ jobId: job.id });
    } catch (err) {
        logErr('QUEUE_ERROR', 'Failed to add Image job', err);
        res.status(500).send('Failed to queue image task.');
    }
});

// 3. Status Polling Route
app.get('/status/:jobId', async (req, res) => {
    const { jobId } = req.params;
    const job = await compressionQueue.getJob(jobId);

    if (!job) {
        return res.status(404).json({ state: 'not_found', message: 'Job not found.' });
    }

    const state = await job.getState(); // waiting, active, completed, failed
    const result = job.returnvalue;

    res.json({
        state,
        progress: job.progress,
        downloadUrl: result ? `/download/${result.compressedFilename}` : null,
        error: job.failedReason
    });
});

// 4. Final Download Route
app.get('/download/:filename', (req, res) => {
    const filePath = path.join(__dirname, 'compressed', req.params.filename);
    
    if (fs.existsSync(filePath)) {
        res.download(filePath, (err) => {
            if (!err) {
                // Optional: Delete file after download to keep server clean
                // fs.unlinkSync(filePath); 
            }
        });
    } else {
        res.status(404).send('File expired or not found.');
    }
});

// --- THE BACKGROUND WORKER ---
// This processes one job at a time (concurrency: 1)
const worker = new Worker('compression-queue', async (job) => {
    const { type, inputPath, originalName, filename } = job.data;
    log('WORKER', `Starting Job ${job.id} (${type}): ${originalName}`);

    if (type === 'pdf') {
        return new Promise((resolve, reject) => {
            const outputPath = `compressed/compressed-${filename}.pdf`;
            const gsCmd = findGhostscriptCommand();

            const args = [
                '-q', '-dNOPAUSE', '-dBATCH', '-dSAFER', '-sDEVICE=pdfwrite',
                '-dCompatibilityLevel=1.4', '-dPDFSETTINGS=/printer',
                `-sOutputFile=${outputPath}`, inputPath
            ];

            const gsProcess = spawn(gsCmd, args);
            gsProcess.on('close', (code) => {
                if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
                if (code === 0) {
                    resolve({ compressedFilename: `compressed-${filename}.pdf` });
                } else {
                    reject(new Error(`Ghostscript exited with code ${code}`));
                }
            });
        });
    } else {
        const ext = path.extname(originalName).toLowerCase() || '.jpg';
        const outputPath = `compressed/compressed-${filename}${ext}`;
        
        let transform = sharp(inputPath);
        if (ext === '.png') transform = transform.png({ compressionLevel: 9, palette: true });
        else if (ext === '.webp') transform = transform.webp({ quality: 85, nearLossless: true });
        else transform = transform.jpeg({ quality: 82, mozjpeg: true });

        await transform.toFile(outputPath);
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        return { compressedFilename: `compressed-${filename}${ext}` };
    }
}, { 
    connection: redisConnection,
    concurrency: 1 // Only process 1 file at a time to prevent CPU overload
});

worker.on('completed', (job) => log('WORKER', `Job ${job.id} completed successfully.`));
worker.on('failed', (job, err) => logErr('WORKER', `Job ${job.id} failed`, err));

const server = app.listen(port, () => {
    log('SERVER', `Queue-based API listening at http://localhost:${port}`);
});

server.keepAliveTimeout = 15 * 60 * 1000;
server.headersTimeout = (15 * 60 * 1000) + 1000;