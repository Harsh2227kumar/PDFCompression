const express = require('express' );
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const port = 3001;

// Use CORS to allow cross-origin requests from your Vercel frontend
app.use(cors());

// Set up multer for file storage in a temporary directory
const upload = multer({ dest: 'uploads/' });

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
    const command = `gs -sDEVICE=pdfwrite -dCompatibilityLevel=1.4 -dPDFSETTINGS=/ebook -dNOPAUSE -dQUIET -dBATCH -sOutputFile=${outputPath} ${inputPath}`;

    exec(command, (error, stdout, stderr) => {
        // Clean up the original uploaded file
        fs.unlinkSync(inputPath);

        if (error) {
            console.error(`Ghostscript Error: ${stderr}`);
            return res.status(500).send('Error during PDF compression.');
        }

        // Send the compressed file back for download
        res.download(outputPath, (err) => {
            if (err) {
                console.error('Download Error:', err);
            }
            // Clean up the compressed file after sending
            fs.unlinkSync(outputPath);
        });
    });
});

app.listen(port, () => {
    console.log(`PDF Compression API listening at http://localhost:${port}` );
});
