"use client";
import { ChangeEvent, FormEvent, useRef, useState, DragEvent, useEffect } from "react";

// Ensure this matches your AWS URL exactly (e.g., http://13.xxx.xxx.xxx)
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function CompressPDF() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // File Handlers
  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSelectedFile(event.target.files?.[0] ?? null);
    setMessage("");
    setIsError(false);
  };

  // Drag & Drop Handlers
  const handleDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    
    const file = e.dataTransfer.files?.[0];
    if (file && file.type === "application/pdf") {
      setSelectedFile(file);
      setMessage("");
      setIsError(false);
    } else {
      setIsError(true);
      setMessage("Please drop a valid PDF file.");
    }
  };

  const openFilePicker = () => {
    fileInputRef.current?.click();
  };

  const handleCompress = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedFile) return;

    setIsCompressing(true);
    setIsError(false);
    setMessage("Uploading to queue...");

    const formData = new FormData();
    formData.append("pdf", selectedFile);

    try {
      // 1. SEND TO QUEUE
      const response = await fetch(`${API_URL}/compress-pdf`, {
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
          
          if (data.state === "active") {
            setMessage("Processing... Our engine is shrinking your PDF.");
          } else if (data.state === "completed") {
            clearInterval(pollInterval);
            setMessage("Compression complete! Starting download...");
            setIsCompressing(false);

            // 3. TRIGGER DOWNLOAD
            const anchor = document.createElement("a");
            anchor.href = `${API_URL}${data.downloadUrl}`;
            anchor.download = `compressed-${selectedFile.name}`;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
          } else if (data.state === "failed") {
            clearInterval(pollInterval);
            throw new Error(data.error || "Queue processing failed.");
          }
        } catch (pollErr: any) {
          clearInterval(pollInterval);
          setIsError(true);
          setMessage(pollErr.message);
          setIsCompressing(false);
        }
      }, 2000); // Poll every 2 seconds

    } catch (error: any) {
      setIsError(true);
      setMessage(error.message || "Failed to connect to API.");
      setIsCompressing(false);
    }
  };

  return (
    <div className="split-layout">
      <div className="text-content">
        <h1 className="page-headline">Professional Grade PDF Compression.</h1>
        <p className="page-description">
          Reduce massive PDF payloads in seconds. Our Ghostscript-powered engine ensures your documents shrink while maintaining pixel-perfect quality.
        </p>
        
        <ul className="features-list">
          <li><span className="feature-icon">✨</span> Lossless Formatting & Fonts preserved.</li>
          <li><span className="feature-icon">🔒</span> Managed via Job Queue for reliability.</li>
          <li><span className="feature-icon">⚡</span> Handles high traffic without server crashes.</li>
        </ul>
      </div>

      <div className="glass-panel">
        <form onSubmit={handleCompress}>
          <div 
            className={`file-input-wrap ${isDragging ? 'drag-active' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={openFilePicker}
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

          <button type="submit" disabled={isCompressing || !selectedFile} className="btn-primary">
            {isCompressing ? "Processing in Queue..." : selectedFile ? `Compress ${selectedFile.name}` : "Upload & Compress"}
          </button>

          {message && (
            <div className={`msg-status ${isError ? "msg-error" : "msg-success"}`}>
              {message}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}