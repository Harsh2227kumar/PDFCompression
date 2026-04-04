"use client";

import { ChangeEvent, FormEvent, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isCompressing, setIsCompressing] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    setSelectedFile(file);
    setMessage("");
    setIsError(false);
  };

  const handleCompress = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedFile) {
      setIsError(true);
      setMessage("Please select a PDF file first.");
      return;
    }

    setIsCompressing(true);
    setIsError(false);
    setMessage("Compressing your PDF...");

    const formData = new FormData();
    formData.append("pdf", selectedFile);

    try {
      const response = await fetch(`${API_URL}/compress`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const serverMessage = await response.text();
        throw new Error(serverMessage || "Compression failed. The server responded with an error.");
      }

      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");

      anchor.style.display = "none";
      anchor.href = downloadUrl;
      anchor.download = `compressed-${selectedFile.name}`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(downloadUrl);

      setMessage("Compression successful. Your download has started.");
    } catch (error) {
      console.error("Error:", error);
      setIsError(true);
      setMessage("An error occurred during compression. Please try again.");
    } finally {
      setIsCompressing(false);
    }
  };

  return (
    <main className="page-shell">
      <section className="page-grid">
        <div className="intro">
          <div className="badge">
            PDF Compression
          </div>
          <div>
            <h1 className="title">
              Compress large PDFs in one click.
            </h1>
            <p className="lede">
              Upload a PDF, send it to the compression API, and download the smaller file immediately. Configure the backend URL with <span className="ledeStrong">NEXT_PUBLIC_API_URL</span>.
            </p>
          </div>

          <div className="steps">
            <div className="step">
              <p className="stepLabel">Step 1</p>
              <p className="stepValue">Choose a PDF</p>
            </div>
            <div className="step">
              <p className="stepLabel">Step 2</p>
              <p className="stepValue">Send to API</p>
            </div>
            <div className="step">
              <p className="stepLabel">Step 3</p>
              <p className="stepValue">Download result</p>
            </div>
          </div>
        </div>

        <div className="formWrap">
          <div className="formGlow" />
          <div className="panel">
            <div>
              <h2 className="panelTitle">
                Compress your file
              </h2>
              <p className="panelCopy">
                Uses the backend route <span className="panelCopyStrong">POST {API_URL}/compress</span> with the field name <span className="panelCopyStrong">pdf</span>.
              </p>
            </div>

            <form className="form" onSubmit={handleCompress}>
              <label className="fieldLabel">
                <span className="fieldName">
                  PDF file
                </span>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={handleFileChange}
                  className="fileInput"
                />
              </label>

              {selectedFile ? (
                <div className="selectedFile">
                  Selected file: <strong>{selectedFile.name}</strong>
                </div>
              ) : null}

              <button
                type="submit"
                disabled={isCompressing || !selectedFile}
                className="primaryButton"
              >
                {isCompressing ? "Compressing..." : "Compress & Download"}
              </button>

              {message ? (
                <p className={`message ${isError ? "messageError" : "messageSuccess"}`}>
                  {message}
                </p>
              ) : null}
            </form>
          </div>
        </div>
      </section>
    </main>
  );
}
