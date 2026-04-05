const express = require('express');
const multer = require('multer');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const { Queue, Worker } = require('bullmq');
const Redis = require('ioredis');
const sharp = require('sharp');

// --- SECURITY IMPORTS ---
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { fileTypeFromFile } = require('file-type');

const app = express();
const port = 3001;

// 1. SECURITY: Set HTTP headers for protection (XSS, Clickjacking, etc.)
app.use(helmet());

// 2. SECURITY: Rate Limiting (Protects your AWS CPU/RAM from spam)
const apiLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour window
    max: 15, // Limit each IP to 15 requests per hour
    message: "Too many requests from this IP, please try again after an hour.",
    standardHeaders: true,
    legacyHeaders: false,
});

// 3. SECURITY: Strict Payload Size Limits
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ limit: '1mb', extended: true }));

app.use(cors());

// --- REDIS & QUEUE ---
const redisConnection = new Redis({ maxRetriesPerRequest: null });
const compressionQueue = new Queue('compression-queue', { connection: redisConnection });

// --- LOGGING ---
const log = (tag, msg) => console.log(`[${new Date().toISOString()}] [INFO] [${tag}] ${msg}`);
const logErr = (tag, msg, err = '') => console.error(`[${new Date().toISOString()}] [ERROR] [${tag}] ${msg}`, err);

// Directories
const uploadDir = 'uploads/';
const compressedDir = 'compressed/';
[uploadDir, compressedDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// 4. SECURITY: Multer strict file limits
const upload = multer({ 
    dest: uploadDir, 
    limits: { 
        fileSize: 50 * 1024 * 1024, // 50MB Hard limit per file
        files: 1 
    } 
});

// --- HELPER: MAGIC BYTE VALIDATION ---
async function isRealFileType(filePath, expectedCategory) {
    const type = await fileTypeFromFile(filePath);
    if (!type) return false;
    if (expectedCategory === 'pdf') return type.mime === 'application/pdf';
    if (expectedCategory === 'image') return type.mime.startsWith('image/');
    return false;
}

// --- API ROUTES ---

// PDF Route (with Rate Limiting)
app.post('/compress-pdf', apiLimiter, upload.single('pdf'), async (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded.');

    // 5. SECURITY: Verify file content (Magic Bytes)
    const isValid = await isRealFileType(req.file.path, 'pdf');
    if (!isValid) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        logErr('SECURITY', `Rejected spoofed PDF from ${req.ip}`);
        return res.status(400).send('File content does not match PDF format.');
    }

    try {
        const job = await compressionQueue.add('pdf-compression', {
            type: 'pdf',
            inputPath: req.file.path,
            originalName: req.file.originalname,
            filename: req.file.filename
        });
        res.json({ jobId: job.id });
    } catch (err) {
        res.status(500).send('Queue Error.');
    }
});

// Image Route (with Rate Limiting)
app.post('/compress-image', apiLimiter, upload.single('image'), async (req, res) => {
    if (!req.file) return res.status(400).send('No file uploaded.');

    const isValid = await isRealFileType(req.file.path, 'image');
    if (!isValid) {
        if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        logErr('SECURITY', `Rejected spoofed Image from ${req.ip}`);
        return res.status(400).send('File content does not match Image format.');
    }

    try {
        const job = await compressionQueue.add('image-compression', {
            type: 'image',
            inputPath: req.file.path,
            originalName: req.file.originalname,
            filename: req.file.filename
        });
        res.json({ jobId: job.id });
    } catch (err) {
        res.status(500).send('Queue Error.');
    }
});

app.get('/status/:jobId', async (req, res) => {
    const job = await compressionQueue.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ state: 'not_found' });

    const state = await job.getState();
    const result = job.returnvalue;
    res.json({
        state,
        downloadUrl: result ? `/download/${result.compressedFilename}` : null,
        error: job.failedReason
    });
});

app.get('/download/:filename', (req, res) => {
    // 6. SECURITY: Prevent Directory Traversal using path.basename
    const safeFilename = path.basename(req.params.filename);
    const filePath = path.join(__dirname, 'compressed', safeFilename);
    
    if (fs.existsSync(filePath)) {
        res.download(filePath, (err) => {
            if (!err && fs.existsSync(filePath)) {
                // Delete file immediately after download
                fs.unlinkSync(filePath); 
            }
        });
    } else {
        res.status(404).send('File not found or expired.');
    }
});

// --- WORKER LOGIC ---
const worker = new Worker('compression-queue', async (job) => {
    const { type, inputPath, originalName, filename } = job.data;
    const outputFilename = `compressed-${filename}${type === 'pdf' ? '.pdf' : path.extname(originalName)}`;
    const outputPath = path.join(compressedDir, outputFilename);

    if (type === 'pdf') {
        return new Promise((resolve, reject) => {
            // 7. SECURITY: Ghostscript -dSAFER flag
            const gsProcess = spawn('gs', [
                '-q', '-dNOPAUSE', '-dBATCH', '-dSAFER', '-sDEVICE=pdfwrite',
                '-dPDFSETTINGS=/printer', `-sOutputFile=${outputPath}`, inputPath
            ]);
            gsProcess.on('close', (code) => {
                if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
                if (code === 0) resolve({ compressedFilename: outputFilename });
                else reject(new Error('Ghostscript Failed'));
            });
        });
    } else {
        await sharp(inputPath).jpeg({ quality: 80, mozjpeg: true }).toFile(outputPath);
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        return { compressedFilename: outputFilename };
    }
}, { connection: redisConnection, concurrency: 1 });

// 8. SECURITY: Auto-Cleanup (Deletes files older than 30 mins from compressed folder)
setInterval(() => {
    const now = Date.now();
    fs.readdirSync(compressedDir).forEach(file => {
        const filePath = path.join(compressedDir, file);
        const stats = fs.statSync(filePath);
        if (now - stats.mtimeMs > 30 * 60 * 1000) {
            fs.unlinkSync(filePath);
            log('CLEANUP', `Deleted expired file: ${file}`);
        }
    });
}, 10 * 60 * 1000); // Runs every 10 minutes

app.listen(port, () => log('SERVER', `Hardened API running on port ${port}`));