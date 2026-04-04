const express = require('express');
const multer = require('multer');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const port = 3001;

// Allow CORS for your Vercel frontend
app.use(cors());

// Increase body parser limits
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ limit: '200mb', extended: true }));

// Setup multer: Increased limit to 200MB to comfortably handle 60MB files
const upload = multer({ 
    dest: 'uploads/', 
    limits: { fileSize: 200 * 1024 * 1024 } 
});

function findGhostscriptCommand() {
    const configuredCommand = process.env.GHOSTSCRIPT_PATH || process.env.GS_PATH;
    if (configuredCommand) return configuredCommand;
    if (process.platform === 'win32') return 'gswin64c';
    return 'gs'; // Default for AWS EC2 Linux
}

function commandExists(command, callback) {
    const probe = process.platform === 'win32' ? 'where' : 'which';
    execFile(probe, [command], (error) => {
        callback(!error);
    });
}

app.post('/compress', upload.single('pdf'), (req, res) => {
    // 1. Extend timeouts to 15 minutes to prevent drops on large files
    req.setTimeout(15 * 60 * 1000); 
    res.setTimeout(15 * 60 * 1000);

    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    const inputPath = req.file.path;
    const outputPath = `compressed/compressed-${req.file.filename}.pdf`;

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const ghostscriptCommand = findGhostscriptCommand();

    commandExists(ghostscriptCommand, (exists) => {
        if (!exists) {
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
            return res.status(503).send('Ghostscript is not installed on the server.');
        }

        // 2. "BEST COMPRESSION" Ghostscript Parameters
        const commandArgs = [
            '-q', '-dNOPAUSE', '-dBATCH', '-dSAFER',
            '-sDEVICE=pdfwrite',
            '-dCompatibilityLevel=1.4',
            
            // Start with a high-quality base (retains document structure)
            '-dPDFSETTINGS=/printer', 
            
            // Smart Image Handling (Visually Lossless)
            '-dAutoFilterColorImages=true',
            '-dAutoFilterGrayImages=true',
            '-dColorImageFilter=/FlateEncode', // Lossless zip compression for images
            '-dGrayImageFilter=/FlateEncode',
            '-dDownsampleColorImages=true',
            '-dColorImageResolution=200',      // 200 DPI cuts size drastically but stays HD visually
            '-dDownsampleGrayImages=true',
            '-dGrayImageResolution=200',
            '-dDownsampleMonoImages=true',
            '-dMonoImageResolution=300',
            
            // Structural Optimization (The "iLovePDF" secret sauce)
            '-dDetectDuplicateImages=true',    // Removes duplicate images across pages
            '-dCompressFonts=true',
            '-dCompressPages=true',
            
            // Formatting & Font Preservation (Zero data loss)
            '-dEmbedAllFonts=true',
            '-dSubsetFonts=true',              // Keeps formatting, strips unused characters
            
            `-sOutputFile=${outputPath}`,
            inputPath,
        ];

        // 3. Use spawn() to prevent Node.js buffer memory crashes on large files
        const gsProcess = spawn(ghostscriptCommand, commandArgs);

        let errorOutput = '';

        gsProcess.stderr.on('data', (data) => {
            errorOutput += data.toString();
        });

        gsProcess.on('close', (code) => {
            // Clean up original uploaded file to save EC2 disk space
            if (fs.existsSync(inputPath)) {
                fs.unlinkSync(inputPath);
            }

            if (code !== 0) {
                console.error(`Ghostscript Error Code ${code}: ${errorOutput}`);
                if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
                return res.status(500).send('Error during PDF compression. The file might be corrupted or protected.');
            }

            if (!fs.existsSync(outputPath)) {
                return res.status(500).send('Compression finished but the file was not created.');
            }

            // Send compressed file back to the browser
            res.download(outputPath, 'compressed.pdf', (downloadError) => {
                if (downloadError) {
                    console.error('Download Error:', downloadError);
                }
                
                // Crucial: Clean up the output file after sending to prevent EC2 storage from filling up
                if (fs.existsSync(outputPath)) {
                    fs.unlinkSync(outputPath);
                }
            });
        });

        gsProcess.on('error', (err) => {
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
            console.error('Ghostscript spawn error:', err);
            res.status(500).send('Server failed to start the compression tool.');
        });
    });
});

const server = app.listen(port, () => {
    console.log(`PDF Compression API listening at http://localhost:${port}`);
});

// 4. Increase global Node.js server timeouts
server.keepAliveTimeout = 15 * 60 * 1000;      // 15 minutes
server.headersTimeout = (15 * 60 * 1000) + 1000; // 15 mins + 1 second buffer