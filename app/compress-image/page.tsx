"use client";
import { ChangeEvent, FormEvent, useRef, useState, DragEvent } from "react";

// Matches your AWS API URL
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
    setMessage("Uploading to queue...");

    const formData = new FormData();
    // Use "image" to match the updated server.js route
    formData.append("image", selectedFile);

    try {
      // 1. SUBMIT TO QUEUE
      const response = await fetch(`${API_URL}/compress-image`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) throw new Error(await response.text());

      const { jobId } = await response.json();
      setMessage("In queue... Waiting for an available worker.");

      // 2. START POLLING FOR STATUS
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch(`${API_URL}/status/${jobId}`);
          if (!statusRes.ok) return;

          const data = await statusRes.json();

          if (data.state === "active") {
            setMessage("Optimizing... Applying mathematically optimal reduction.");
          } else if (data.state === "completed") {
            clearInterval(pollInterval);
            setMessage("Optimization complete! Your download is starting.");
            setIsCompressing(false);

            // 3. TRIGGER DOWNLOAD
            const anchor = document.createElement("a");
            anchor.href = `${API_URL}${data.downloadUrl}`;
            anchor.download = `optimized-${selectedFile.name}`;
            document.body.appendChild(anchor);
            anchor.click();
            anchor.remove();
          } else if (data.state === "failed") {
            clearInterval(pollInterval);
            throw new Error(data.error || "Image optimization failed in the queue.");
          }
        } catch (pollErr: any) {
          clearInterval(pollInterval);
          setIsError(true);
          setMessage(pollErr.message);
          setIsCompressing(false);
        }
      }, 2000); // Check every 2 seconds

    } catch (error: any) {
      setIsError(true);
      setMessage(error.message || "Failed to connect to API.");
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
            Asynchronous queue processing for maximum reliability.
          </li>
        </ul>
      </div>

      {/* Right Column: Upload Panel */}
      <div className="glass-panel">
        <form onSubmit={handleCompress}>
          <div
            className={`file-input-wrap ${isDragging ? "drag-active" : ""}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={openFilePicker}
            style={{ cursor: "pointer" }}
          >
            <div className="upload-icon">🖼️</div>
            <p className="upload-prompt">
              {selectedFile
                ? `Selected: ${selectedFile.name}`
                : isDragging
                ? "Drop your Image here"
                : "Drag & drop your Image here, or click to browse"}
            </p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg, image/png, image/webp, .jpg, .jpeg"
              onChange={handleFileChange}
              className="file-input"
              style={{ display: "none" }}
            />
          </div>

          <button
            type="submit"
            disabled={isCompressing || !selectedFile}
            className="btn-primary"
          >
            {isCompressing
              ? "Processing in Queue..."
              : selectedFile
              ? `Optimize ${selectedFile.name}`
              : "Upload & Compress"}
          </button>

          {message && (
            <div
              className={`msg-status ${isError ? "msg-error" : "msg-success"}`}
            >
              {message}
            </div>
          )}
        </form>
      </div>
    </div>
  );
}