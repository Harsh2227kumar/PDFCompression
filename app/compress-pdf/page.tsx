"use client";
import { ChangeEvent, FormEvent, useState, DragEvent } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function CompressPDF() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

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

  const handleCompress = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedFile) return;

    setIsCompressing(true);
    setIsError(false);
    setMessage("Processing payload... This may take a moment for large files.");

    const formData = new FormData();
    formData.append("pdf", selectedFile);

    try {
      const response = await fetch(`${API_URL}/compress`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) throw new Error(await response.text());

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = `compressed-${selectedFile.name}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(downloadUrl);

      setMessage("Compression complete. Download starting.");
    } catch (error: any) {
      setIsError(true);
      setMessage(error.message || "Failed to connect to API.");
    } finally {
      setIsCompressing(false);
    }
  };

  return (
    <div className="split-layout">
      {/* Left Column: Content */}
      <div className="text-content">
        <h1 className="page-headline">Professional Grade PDF Compression.</h1>
        <p className="page-description">
          Reduce massive PDF payloads in seconds. Our Ghostscript-powered engine ensures your documents shrink in size while maintaining pixel-perfect quality.
        </p>
        
        <ul className="features-list">
          <li>
            <span className="feature-icon">✨</span>
            Lossless Formatting & Embedded Fonts preserved.
          </li>
          <li>
            <span className="feature-icon">🔒</span>
            Files are processed entirely in memory and auto-deleted.
          </li>
          <li>
            <span className="feature-icon">⚡</span>
            Handles heavy documents up to 60MB smoothly.
          </li>
        </ul>
      </div>

      {/* Right Column: Upload Panel */}
      <div className="glass-panel">
        <form onSubmit={handleCompress}>
          <div 
            className={`file-input-wrap ${isDragging ? 'drag-active' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="upload-icon" aria-hidden="true" />
            <p className="upload-prompt">
              {isDragging ? "Drop your PDF here" : "Drag & drop your PDF here, or click to browse"}
            </p>
            <input 
              type="file" 
              accept="application/pdf,.pdf" 
              onChange={handleFileChange} 
              className="file-input"
            />
          </div>

          <button type="submit" disabled={isCompressing || !selectedFile} className="btn-primary">
            {isCompressing ? "Compressing..." : selectedFile ? `Compress ${selectedFile.name}` : "Upload & Compress"}
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