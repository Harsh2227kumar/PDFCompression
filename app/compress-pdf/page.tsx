"use client";
import { ChangeEvent, FormEvent, useRef, useState, DragEvent } from "react";
import posthog from "posthog-js";

// Ensure this matches your AWS URL exactly (e.g., http://13.xxx.xxx.xxx:3001)
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function CompressPDF() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  
  // State for the "The Win" comparison stats
  const [stats, setStats] = useState<{ original: string, compressed: string, saving: string } | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Helper to format bytes into readable MB
  const formatSize = (bytes: number) => (bytes / (1024 * 1024)).toFixed(2) + " MB";

  const handleFileChange = (e: ChangeEvent<HTMLInputElement> | DragEvent<HTMLDivElement>) => {
    let file: File | null = null;
    if ("files" in e.target && e.target.files) {
      file = e.target.files[0];
    } else if ("dataTransfer" in e) {
      file = e.dataTransfer.files[0];
    }

    if (file && file.type === "application/pdf") {
      setSelectedFile(file);
      setMessage("");
      setIsError(false);
      setProgress(0);
      setStats(null);
    } else if (file) {
      setIsError(true);
      setMessage("Please upload a valid PDF file.");
    }
  };

  const handleCompress = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedFile) return;

    setIsCompressing(true);
    setIsError(false);
    setStats(null);
    setProgress(5);
    setMessage("Uploading to secure queue...");

    const formData = new FormData();
    formData.append("pdf", selectedFile);

    try {
      // 1. SUBMIT JOB TO BULLMQ QUEUE
      const response = await fetch(`${API_URL}/compress-pdf`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) throw new Error(await response.text());

      const { jobId } = await response.json();
      setMessage("In queue... Waiting for worker.");

      // 2. POLL FOR STATUS
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch(`${API_URL}/status/${jobId}`);
          if (!statusRes.ok) return;

          const data = await statusRes.json();

          // Sync numeric progress from worker
          if (data.progress) setProgress(data.progress);

          if (data.state === "active") {
            setMessage("Processing... Our engine is shrinking your PDF.");
          } else if (data.state === "completed") {
            // STOP POLLING
            clearInterval(pollInterval);
            setProgress(100);

            // FIX UI GLITCH: Clear loading state and messages immediately
            setMessage(""); 
            setIsCompressing(false);

            const baseUrl = API_URL.endsWith('/') ? API_URL.slice(0, -1) : API_URL;
            
            // Fetch headers to calculate "The Win" accurately
            const fileCheck = await fetch(`${baseUrl}${data.downloadUrl}`);
            const compSize = parseInt(fileCheck.headers.get("content-length") || "0");
            const saving = (((selectedFile.size - compSize) / selectedFile.size) * 100).toFixed(0);
            
            // Set Comparison Stats
            setStats({
              original: formatSize(selectedFile.size),
              compressed: formatSize(compSize),
              saving: saving
            });

            // Track Success in PostHog
            if (typeof window !== 'undefined' && posthog && posthog.capture) {
              posthog.capture("compression_success", {
                file_type: "pdf",
                original_name: selectedFile?.name,
                file_size: selectedFile?.size,
                saving_percent: saving
              });
            }

            // 3. TRIGGER AUTO-DOWNLOAD
            const anchor = document.createElement("a");
            anchor.href = `${baseUrl}${data.downloadUrl}`;
            anchor.download = `compressed-${selectedFile?.name || 'document.pdf'}`;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();

          } else if (data.state === "failed") {
            clearInterval(pollInterval);
            const errorMsg = data.error || "The PDF engine failed to process this file.";
            setIsError(true);
            setMessage(errorMsg);
            setIsCompressing(false);
          }
        } catch (pollErr: any) {
          clearInterval(pollInterval);
          setIsError(true);
          setMessage("Lost connection to server.");
          setIsCompressing(false);
        }
      }, 1500);

    } catch (error: any) {
      setIsError(true);
      setMessage(error.message || "Failed to connect to API.");
      setIsCompressing(false);
    }
  };

  return (
    <div className="split-layout">
      {/* Left Column: Headline and Trust Elements */}
      <div className="text-content">
        <h1 className="page-headline">Professional Grade PDF Compression.</h1>
        <p className="page-description">
          Reduce massive PDF payloads in seconds. Our Ghostscript-powered engine ensures your documents shrink while maintaining pixel-perfect quality.
        </p>

        {/* TRUST BADGE */}
        <div className="trust-badge">
          <span className="shield-icon">🛡️</span>
          <p>Files are processed via secure queue and auto-deleted after 30 minutes.</p>
        </div>

        <ul className="features-list">
          <li><span className="feature-icon">✨</span> Lossless Formatting & Fonts preserved.</li>
          <li><span className="feature-icon">🔒</span> Managed via Secure Job Queue.</li>
          <li><span className="feature-icon">⚡</span> Real-time progress tracking.</li>
        </ul>
      </div>

      {/* Right Column: Interaction Panel */}
      <div className="glass-panel">
        <form onSubmit={handleCompress}>
          <div
            className={`file-input-wrap ${isDragging ? 'drag-active' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => { e.preventDefault(); setIsDragging(false); handleFileChange(e as any); }}
            onClick={() => fileInputRef.current?.click()}
            style={{ cursor: 'pointer' }}
          >
            <div className="upload-icon">📄</div>
            <p className="upload-prompt">
              {selectedFile ? `Selected: ${selectedFile.name}` : isDragging ? "Drop your PDF here" : "Drag & drop your PDF here, or click to browse"}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf,.pdf"
              onChange={handleFileChange}
              className="file-input"
              style={{ display: 'none' }}
            />
          </div>

          {/* PROGRESS BAR UI */}
          {isCompressing && (
            <div className="progress-container">
              <div className="progress-info">
                <span className="progress-msg">{message}</span>
                <span className="progress-percent">{progress}%</span>
              </div>
              <div className="progress-track">
                <div 
                  className="progress-fill" 
                  style={{ width: `${progress}%` }}
                ></div>
              </div>
            </div>
          )}

          {/* SUCCESS STATS "THE WIN" */}
          {stats && (
            <div className="stats-win">
              <div className="stats-row">
                <span>{stats.original}</span> 
                <span>→</span> 
                <span><strong>{stats.compressed}</strong></span>
              </div>
              <div className="stats-saving">{stats.saving}% Smaller! ✨</div>
            </div>
          )}

          <button type="submit" disabled={isCompressing || !selectedFile} className="btn-primary">
            {isCompressing ? "Shrinking PDF..." : selectedFile ? `Compress ${selectedFile.name}` : "Upload & Compress"}
          </button>

          {!isCompressing && message && (
            <div className={`msg-status ${isError ? "msg-error" : "msg-success"}`}>
              {message}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}