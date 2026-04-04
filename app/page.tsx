import Link from "next/link";

export default function Home() {
  return (
    <main style={{ textAlign: "center" }}>
      <h1 className="hero-title">Optimize your files.</h1>
      <p className="hero-subtitle" style={{ margin: "0 auto 3rem auto" }}>
        A developer-first suite for reducing payload sizes. Select a tool below to instantly compress documents and images with zero visual data loss.
      </p>

      <div className="card-grid">
        <Link href="/compress-pdf" className="tool-card">
          <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>📄</div>
          <h2 style={{ fontSize: "1.2rem", marginBottom: "0.5rem" }}>Compress PDF</h2>
          <p style={{ color: "#a1a1aa", fontSize: "0.9rem", lineHeight: "1.5" }}>
            Reduce heavy document sizes while preserving font styling, vector data, and layout integrity.
          </p>
        </Link>

        <Link href="/compress-image" className="tool-card">
          <div style={{ fontSize: "2rem", marginBottom: "1rem" }}>🖼️</div>
          <h2 style={{ fontSize: "1.2rem", marginBottom: "0.5rem" }}>Compress Image</h2>
          <p style={{ color: "#a1a1aa", fontSize: "0.9rem", lineHeight: "1.5" }}>
            Shrink JPG, PNG, and WebP payloads. Powered by MozJPEG and Sharp for mathematically optimal reduction.
          </p>
        </Link>
      </div>
    </main>
  );
}