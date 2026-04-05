"use client";
import { ChangeEvent, FormEvent, useRef, useState, DragEvent } from "react";
import posthog from "posthog-js";

// Ensure this matches your AWS URL exactly
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function CompressImage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  
  // State for Comparison Stats
  const [stats, setStats] = useState<{ original: string, compressed: string, saving: string } | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Helper to format bytes
  const formatSize = (bytes: number) => (bytes / (1024 * 1024)).toFixed(2) + " MB";

  const handleFileChange = (e: ChangeEvent<HTMLInputElement> | DragEvent<HTMLDivElement>) => {
    let file: File | null = null;
    if ("files" in e.target && e.target.files) {
      file = e.target.files[0];
    } else if ("dataTransfer" in e) {
      file = e.dataTransfer.files[0];
    }

    if (file && file.type.startsWith("image/")) {
      setSelectedFile(file);
      setMessage("");
      setIsError(false);
      setProgress(0);
      setStats(null);
    } else if (file) {
      setIsError(true);
      setMessage("Please upload a valid Image (JPG, PNG, or WebP).");
    }
  };

  const handleCompress = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedFile) return;

    // --- SIZE GUARD (Prevents Vercel Router Errors) ---
    const MAX_LIMIT = 25 * 1024 * 1024; // 25MB Limit
    if (selectedFile.size > MAX_LIMIT) {
      setIsError(true);
      setMessage(`File too large (${formatSize(selectedFile.size)}). Max limit is 25MB.`);
      return;
    }

    setIsCompressing(true);
    setIsError(false);
    setProgress(5);
    setStats(null);
    setMessage("Uploading to secure queue...");

    const formData = new FormData();
    formData.append("image", selectedFile);

    try {
      // 1. SUBMIT TO BULLMQ
      const response = await fetch(`${API_URL}/compress-image`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) throw new Error(await response.text());

      const { jobId } = await response.json();
      setMessage("In queue... Waiting for worker.");

      // 2. START POLLING
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch(`${API_URL}/status/${jobId}`);
          if (!statusRes.ok) return;

          const data = await statusRes.json();

          // Sync numeric progress
          if (data.progress) setProgress(data.progress);

          if (data.state === "active") {
            setMessage("Optimizing... Applying mathematically optimal reduction.");
          } else if (data.state === "completed") {
            clearInterval(pollInterval);
            setProgress(100);
            
            // FIX UI GLITCH: Clear messages immediately
            setMessage(""); 
            setIsCompressing(false);

            const baseUrl = API_URL.endsWith('/') ? API_URL.slice(0, -1) : API_URL;
            
            // Fetch metadata for "The Win" stats
            const fileCheck = await fetch(`${baseUrl}${data.downloadUrl}`);
            const compSize = parseInt(fileCheck.headers.get("content-length") || "0");
            const saving = (((selectedFile.size - compSize) / selectedFile.size) * 100).toFixed(0);
            
            setStats({
              original: formatSize(selectedFile.size),
              compressed: formatSize(compSize),
              saving: saving
            });

            // PostHog Tracking
            if (typeof window !== 'undefined' && posthog && posthog.capture) {
              posthog.capture("compression_success", {
                file_type: "image",
                original_name: selectedFile?.name,
                file_size: selectedFile?.size,
                saving_percent: saving
              });
            }

            // 3. Trigger Download
            const anchor = document.createElement("a");
            anchor.href = `${baseUrl}${data.downloadUrl}`;
            anchor.download = `optimized-${selectedFile?.name || 'image.jpg'}`;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();

          } else if (data.state === "failed") {
            clearInterval(pollInterval);
            setIsError(true);
            setMessage(data.error || "Optimization failed. Please try a different image.");
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
      <div className="text-content">
        <h1 className="page-headline">Intelligent Image Optimization.</h1>
        <p className="page-description">
          Reduce JPG, PNG, and WebP payloads for faster loading times and better SEO. Our engine applies mathematically optimal reduction to keep images visually identical.
        </p>

        {/* Privacy Trust Badge */}
        <div className="trust-badge">
          <span className="shield-icon">🛡️</span>
          <p>Files are processed via secure queue and auto-deleted after 30 minutes.</p>
        </div>

        <ul className="features-list">
          <li><span className="feature-icon">⚙️</span> Powered by industry-standard MozJPEG.</li>
          <li><span className="feature-icon">🎨</span> Transparency & alpha channels preserved.</li>
          <li><span className="feature-icon">⚡</span> Real-time progress monitoring.</li>
        </ul>
      </div>

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
            <p className="upload-prompt">
              {selectedFile ? `Selected: ${selectedFile.name}` : isDragging ? "Drop your Image here" : "Drag & drop your Image here, or click to browse"}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg, image/png, image/webp, .jpg, .jpeg"
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

          {/* Success Stats "The Win" */}
          {stats && (
            <div className="stats-win">
              <div className="stats-row">
                <span>{stats.original}</span> 
                <span>→</span> 
                <span><strong>{stats.compressed}</strong></span>
              </div>
              <div className="stats-saving">{stats.saving}% Saved! ✨</div>
            </div>
          )}

          <button type="submit" disabled={isCompressing || !selectedFile} className="btn-primary">
            {isCompressing ? "Optimizing..." : selectedFile ? `Optimize ${selectedFile.name}` : "Upload & Optimize"}
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