const express = require('express');
const multer = require('multer');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const port = 3001;

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

const upload = multer({ 
    dest: 'uploads/', 
    limits: { fileSize: 200 * 1024 * 1024 } 
});

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

app.post('/compress', upload.single('pdf'), (req, res) => {
    req.setTimeout(15 * 60 * 1000); 
    res.setTimeout(15 * 60 * 1000);

    log('API', `--- New Compression Request Started ---`);

    if (!req.file) {
        logErr('API', 'Request rejected. No file was attached to the payload.');
        return res.status(400).send('No file uploaded.');
    }

    const fileSizeMB = (req.file.size / (1024 * 1024)).toFixed(2);
    log('UPLOAD', `Received file: "${req.file.originalname}" | Temp Name: ${req.file.filename} | Size: ${fileSizeMB} MB`);

    const inputPath = req.file.path;
    const outputPath = `compressed/compressed-${req.file.filename}.pdf`;

    try {
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    } catch (dirErr) {
        logErr('SYSTEM', 'Failed to create compressed directory', dirErr);
        return res.status(500).send('Internal server error creating directories.');
    }

    const ghostscriptCommand = findGhostscriptCommand();

    commandExists(ghostscriptCommand, (exists) => {
        if (!exists) {
            logErr('SYSTEM', `Ghostscript command '${ghostscriptCommand}' not found on server.`);
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
            return res.status(503).send('Ghostscript is not installed on the server.');
        }

        const commandArgs = [
            '-q', '-dNOPAUSE', '-dBATCH', '-dSAFER',
            '-sDEVICE=pdfwrite',
            '-dCompatibilityLevel=1.4',
            '-dPDFSETTINGS=/printer', 
            '-dAutoFilterColorImages=true',
            '-dAutoFilterGrayImages=true',
            '-dColorImageFilter=/FlateEncode', 
            '-dGrayImageFilter=/FlateEncode',
            '-dDownsampleColorImages=true',
            '-dColorImageResolution=200',      
            '-dDownsampleGrayImages=true',
            '-dGrayImageResolution=200',
            '-dDownsampleMonoImages=true',
            '-dMonoImageResolution=300',
            '-dDetectDuplicateImages=true',    
            '-dCompressFonts=true',
            '-dCompressPages=true',
            '-dEmbedAllFonts=true',
            '-dSubsetFonts=true',              
            `-sOutputFile=${outputPath}`,
            inputPath,
        ];

        log('GHOSTSCRIPT', `Executing: ${ghostscriptCommand} ${commandArgs.join(' ')}`);

        const gsProcess = spawn(ghostscriptCommand, commandArgs);
        let errorOutput = '';

        gsProcess.stderr.on('data', (data) => {
            const stderrMsg = data.toString();
            errorOutput += stderrMsg;
            // Log Ghostscript warnings in real-time
            logErr('GHOSTSCRIPT_STDERR', stderrMsg.trim());
        });

        gsProcess.on('close', (code) => {
            log('PROCESS', `Ghostscript exited with code ${code}`);

            if (fs.existsSync(inputPath)) {
                fs.unlinkSync(inputPath);
                log('CLEANUP', `Deleted original temp file: ${inputPath}`);
            }

            if (code !== 0) {
                logErr('COMPRESSION_FAILED', `Code ${code}. Details: ${errorOutput}`);
                if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                return res.status(500).send(`Compression failed. Server logs say: ${errorOutput.substring(0, 200)}...`);
            }

            if (!fs.existsSync(outputPath)) {
                logErr('COMPRESSION_FAILED', `Process finished with code 0, but output file ${outputPath} is missing!`);
                return res.status(500).send('Compression finished but the file was not created.');
            }

            const outSizeMB = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(2);
            log('SUCCESS', `Compression complete. New size: ${outSizeMB} MB. Sending to client...`);

            res.download(outputPath, 'compressed.pdf', (downloadError) => {
                if (downloadError) {
                    logErr('NETWORK', 'Failed to send file to client (Browser might have cancelled or timed out)', downloadError);
                } else {
                    log('NETWORK', 'File successfully delivered to client.');
                }
                
                if (fs.existsSync(outputPath)) {
                    fs.unlinkSync(outputPath);
                    log('CLEANUP', `Deleted compressed file: ${outputPath}`);
                }
            });
        });

        gsProcess.on('error', (err) => {
            logErr('SPAWN_ERROR', 'Failed to start the Ghostscript process', err);
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
            res.status(500).send('Server failed to start the compression tool.');
        });
    });
});



const sharp = require('sharp');

// --- NEW ENDPOINT: IMAGE COMPRESSION ---
app.post('/compress-image', upload.single('image'), async (req, res) => {
    log('API', `--- New Image Compression Request Started ---`);

    if (!req.file) {
        logErr('API', 'No image uploaded.');
        return res.status(400).send('No image uploaded.');
    }

    const inputPath = req.file.path;
    const originalExt = path.extname(req.file.originalname).toLowerCase();
    
    // Fallback to .jpg if extension is weird, otherwise keep original
    const ext = ['.png', '.webp', '.jpg', '.jpeg'].includes(originalExt) ? originalExt : '.jpg';
    const outputPath = `compressed/compressed-${req.file.filename}${ext}`;

    try {
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });

        // Visually Lossless Configuration using Sharp
        let transform = sharp(inputPath);

        if (ext === '.png') {
            // PNG: Maximum compression effort, lossless
            transform = transform.png({ compressionLevel: 9, adaptiveFiltering: true });
        } else if (ext === '.webp') {
            // WebP: Near-lossless config
            transform = transform.webp({ quality: 85, nearLossless: true });
        } else {
            // JPEG: MozJPEG engine for massive size reduction without visual quality drop
            transform = transform.jpeg({ quality: 82, mozjpeg: true });
        }

        await transform.toFile(outputPath);
        
        const outSizeMB = (fs.statSync(outputPath).size / (1024 * 1024)).toFixed(2);
        log('SUCCESS', `Image compressed. New size: ${outSizeMB} MB. Sending...`);

        res.download(outputPath, `compressed-${req.file.originalname}`, (downloadError) => {
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
            if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
        });

    } catch (error) {
        logErr('IMAGE_ERROR', 'Sharp failed to process image', error);
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        res.status(500).send('Server failed to compress the image.');
    }
});


const server = app.listen(port, () => {
    log('SERVER', `PDF Compression API listening at http://localhost:${port}`);
});

server.keepAliveTimeout = 15 * 60 * 1000;
server.headersTimeout = (15 * 60 * 1000) + 1000;