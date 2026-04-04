const express = require('express' );
const multer = require('multer');
const { execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const port = 3001;

// Use CORS to allow cross-origin requests from your Vercel frontend
app.use(cors());

// Set up multer for file storage in a temporary directory
const upload = multer({ dest: 'uploads/' });

function findGhostscriptCommand() {
    const configuredCommand = process.env.GHOSTSCRIPT_PATH || process.env.GS_PATH;

    if (configuredCommand) {
        return configuredCommand;
    }

    if (process.platform === 'win32') {
        return 'gswin64c';
    }

    return 'gs';
}

function commandExists(command, callback) {
    const probe = process.platform === 'win32' ? 'where' : 'which';
    const probeArgs = process.platform === 'win32' ? [command] : [command];

    execFile(probe, probeArgs, (error) => {
        callback(!error);
    });
}

// Define the compression endpoint
app.post('/compress', upload.single('pdf'), (req, res) => {
    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

    const inputPath = req.file.path;
    const outputPath = `compressed/compressed-${req.file.filename}.pdf`;

    // Ensure the output directory exists
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    // Ghostscript command for compression
    // -dPDFSETTINGS=/ebook provides a good balance of size and quality
    const ghostscriptCommand = findGhostscriptCommand();

    commandExists(ghostscriptCommand, (exists) => {
        if (!exists) {
            fs.unlinkSync(inputPath);
            return res.status(503).send('Ghostscript is not installed or not available on PATH. Install Ghostscript or set GHOSTSCRIPT_PATH to the executable path.');
        }

        const commandArgs = [
            '-sDEVICE=pdfwrite',
            '-dCompatibilityLevel=1.4',
            '-dPDFSETTINGS=/ebook',
            '-dNOPAUSE',
            '-dQUIET',
            '-dBATCH',
            `-sOutputFile=${outputPath}`,
            inputPath,
        ];

        execFile(ghostscriptCommand, commandArgs, (error, stdout, stderr) => {
            // Clean up the original uploaded file
            fs.unlinkSync(inputPath);

            if (error) {
                console.error(`Ghostscript Error: ${stderr || error.message}`);
                return res.status(500).send(stderr || 'Error during PDF compression.');
            }

            // Send the compressed file back for download
            res.download(outputPath, (downloadError) => {
                if (downloadError) {
                    console.error('Download Error:', downloadError);
                }

                // Clean up the compressed file after sending
                if (fs.existsSync(outputPath)) {
                    fs.unlinkSync(outputPath);
                }
            });
        });
    });
});

app.listen(port, () => {
    console.log(`PDF Compression API listening at http://localhost:${port}` );
});
