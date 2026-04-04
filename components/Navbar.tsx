import Link from "next/link";

export default function Navbar() {
  return (
    <nav className="navbar">
      <Link href="/" className="nav-brand">
        FileCompressor
      </Link>
      <div className="nav-links">
        <Link href="/">Home</Link>
        <Link href="/compress-pdf">Compress PDF</Link>
        <Link href="/compress-image">Compress Image</Link>
      </div>
    </nav>
  );
}