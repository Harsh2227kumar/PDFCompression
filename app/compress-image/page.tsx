"use client";
import { ChangeEvent, FormEvent, useRef, useState, DragEvent } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function CompressImage() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setSelectedFile(event.target.files?.[0] ?? null);
    setMessage("");
    setIsError(false);
  };

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
    if (file && file.type.startsWith("image/")) {
      setSelectedFile(file);
      setMessage("");
      setIsError(false);
    } else {
      setIsError(true);
      setMessage("Please drop a valid Image file (JPG, PNG, WebP).");
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
    setMessage("Processing image...");

    const formData = new FormData();
    formData.append("image", selectedFile);

    try {
      // Remove trailing slash if it exists, then add the route
      const cleanBaseUrl = API_URL.endsWith('/') ? API_URL.slice(0, -1) : API_URL;

      const response = await fetch(`${cleanBaseUrl}/compress-image`, {
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

      setMessage("Optimization complete. Download starting.");
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
        <h1 className="page-headline">Intelligent Image Optimization.</h1>
        <p className="page-description">
          Reduce JPG, PNG, and WebP payloads for faster loading times and better SEO. Our backend applies mathematically optimal reduction to keep images visually identical.
        </p>

        <ul className="features-list">
          <li>
            <span className="feature-icon">⚙️</span>
            Powered by the industry-standard MozJPEG engine.
          </li>
          <li>
            <span className="feature-icon">🎨</span>
            Preserves alpha channels and transparency perfectly.
          </li>
          <li>
            <span className="feature-icon">🛡️</span>
            Zero data retention. Images are wiped from the server instantly.
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
            onClick={openFilePicker}
          >
            <div
              className="upload-icon"
              aria-label="Select image file"
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openFilePicker();
                }
              }}
            />
            <p className="upload-prompt">
              {isDragging ? "Drop your Image here" : "Drag & drop your Image here, or click to browse"}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg, image/png, image/webp, .jpg"
              onChange={handleFileChange}
              className="file-input file-input-hidden"
            />
          </div>

          <button type="submit" disabled={isCompressing || !selectedFile} className="btn-primary">
            {isCompressing ? "Compressing..." : selectedFile ? `Optimize ${selectedFile.name}` : "Upload & Compress"}
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