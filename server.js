const express = require("express");
const multer = require("multer");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const { Queue, Worker } = require("bullmq");
const Redis = require("ioredis");
const sharp = require("sharp");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { fileTypeFromFile } = require("file-type");

const app = express();
const port = 3001;

// 1. SECURITY & HEADERS
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ limit: "1mb", extended: true }));

const apiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 15,
  message: "Too many requests. Please try again after an hour.",
  standardHeaders: true,
  legacyHeaders: false,
});

// 2. REDIS & QUEUE CONFIGURATION
const redisConnection = new Redis({
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
});

// Global Error Handling for Redis
redisConnection.on("error", (err) => console.error("[REDIS FATAL ERROR]", err));

const compressionQueue = new Queue("compression-queue", {
  connection: redisConnection,
});

// 3. LOGGING & DIRECTORIES
const log = (tag, msg) =>
  console.log(`[${new Date().toISOString()}] [INFO] [${tag}] ${msg}`);
const logErr = (tag, msg, err = "") =>
  console.error(`[${new Date().toISOString()}] [ERROR] [${tag}] ${msg}`, err);

const uploadDir = "uploads/";
const compressedDir = "compressed/";
[uploadDir, compressedDir].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: 50 * 1024 * 1024, files: 1 },
});

async function isRealFileType(filePath, expectedCategory) {
  const type = await fileTypeFromFile(filePath);
  if (!type) return false;
  return expectedCategory === "pdf"
    ? type.mime === "application/pdf"
    : type.mime.startsWith("image/");
}

// --- 5. AUTOMATED HEALTH CHECKS ---
// You can point UptimeRobot or StatusCake to this URL: /health
app.get("/health", async (req, res) => {
  const redisStatus = redisConnection.status === "ready" ? "UP" : "DOWN";
  const queueSize = await compressionQueue.count();

  const health = {
    status: "UP",
    uptime: process.uptime(),
    timestamp: Date.now(),
    services: {
      redis: redisStatus,
      storage: fs.existsSync(uploadDir) ? "UP" : "DOWN",
    },
    load: queueSize,
  };

  if (redisStatus === "DOWN") return res.status(503).json(health);
  res.json(health);
});

// --- API ROUTES ---

// 2. GLOBAL ERROR HANDLING & RESILIENCE (Added to Job options)
const JOB_OPTIONS = {
  attempts: 3, // Retry up to 3 times on failure
  backoff: {
    type: "exponential",
    delay: 5000, // Wait 5s, then 10s, then 20s
  },
  removeOnComplete: { age: 3600 }, // Clear successful jobs after 1 hour
  removeOnFail: { age: 24 * 3600 }, // Keep failed jobs for 24h for debugging
};

app.post(
  "/compress-pdf",
  apiLimiter,
  upload.single("pdf"),
  async (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded.");
    if (!(await isRealFileType(req.file.path, "pdf"))) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).send("Invalid PDF content.");
    }

    try {
      const job = await compressionQueue.add(
        "pdf-compression",
        {
          type: "pdf",
          inputPath: req.file.path,
          originalName: req.file.originalname,
          filename: req.file.filename,
        },
        JOB_OPTIONS,
      );
      res.json({ jobId: job.id });
    } catch (err) {
      res.status(500).send("Queue Error.");
    }
  },
);

app.post(
  "/compress-image",
  apiLimiter,
  upload.single("image"),
  async (req, res) => {
    if (!req.file) return res.status(400).send("No file uploaded.");
    if (!(await isRealFileType(req.file.path, "image"))) {
      if (fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      return res.status(400).send("Invalid image content.");
    }

    try {
      const job = await compressionQueue.add(
        "image-compression",
        {
          type: "image",
          inputPath: req.file.path,
          originalName: req.file.originalname,
          filename: req.file.filename,
        },
        JOB_OPTIONS,
      );
      res.json({ jobId: job.id });
    } catch (err) {
      res.status(500).send("Queue Error.");
    }
  },
);

app.get("/status/:jobId", async (req, res) => {
  const job = await compressionQueue.getJob(req.params.jobId);
  if (!job) return res.status(404).json({ state: "not_found" });
  const state = await job.getState();
  const result = job.returnvalue;
  res.json({
    state,
    downloadUrl: result ? `/download/${result.compressedFilename}` : null,
    error: job.failedReason,
  });
});

app.get("/download/:filename", (req, res) => {
  const safeFilename = path.basename(req.params.filename);
  const filePath = path.join(__dirname, "compressed", safeFilename);
  if (fs.existsSync(filePath)) {
    res.download(filePath, (err) => {
      if (!err && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    });
  } else {
    res.status(404).send("File not found.");
  }
});

// --- WORKER LOGIC ---
const worker = new Worker(
  "compression-queue",
  async (job) => {
    const { type, inputPath, originalName, filename } = job.data;
    const outputFilename = `compressed-${filename}${
      type === "pdf" ? ".pdf" : path.extname(originalName)
    }`;
    const outputPath = path.join(compressedDir, outputFilename);

    try {
      // 1. Initial Step: File Received (10%)
      await job.updateProgress(10);
      log('WORKER', `Processing Job ${job.id}: ${originalName}`);

      if (type === "pdf") {
        return new Promise(async (resolve, reject) => {
          // 2. Ghostscript Starting (30%)
          await job.updateProgress(30);

          const gsProcess = spawn("gs", [
            "-q",
            "-dNOPAUSE",
            "-dBATCH",
            "-dSAFER",
            "-sDEVICE=pdfwrite",
            "-dPDFSETTINGS=/printer",
            `-sOutputFile=${outputPath}`,
            inputPath,
          ]);

          gsProcess.on("close", async (code) => {
            if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
            
            if (code === 0) {
              // 3. Success (100%)
              await job.updateProgress(100);
              resolve({ compressedFilename: outputFilename });
            } else {
              reject(new Error(`GS code ${code}`));
            }
          });

          // Optional: If Ghostscript takes a long time, we could 
          // simulate a jump to 70% after a few seconds if the process is still alive
        });
      } else {
        // 2. Image Processing Starting (40%)
        await job.updateProgress(40);

        await sharp(inputPath)
          .jpeg({ quality: 80, mozjpeg: true })
          .toFile(outputPath);

        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);

        // 3. Success (100%)
        await job.updateProgress(100);
        return { compressedFilename: outputFilename };
      }
    } catch (workerErr) {
      if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
      throw workerErr;
    }
  },
  {
    connection: redisConnection,
    concurrency: 1, // <--- Crucial for your 1GB RAM
    lockDuration: 60000, 
    maxStalledCount: 1, 
  }
);

worker.on("failed", (job, err) =>
  logErr("WORKER", `Job ${job.id} permanently failed after retries`, err),
);

// --- AUTO-CLEANUP ---
setInterval(
  () => {
    const now = Date.now();
    if (fs.existsSync(compressedDir)) {
      fs.readdirSync(compressedDir).forEach((file) => {
        const stats = fs.statSync(path.join(compressedDir, file));
        if (now - stats.mtimeMs > 30 * 60 * 1000)
          fs.unlinkSync(path.join(compressedDir, file));
      });
    }
  },
  15 * 60 * 1000,
);

app.listen(port, () => log("SERVER", `Production API running on port ${port}`));
