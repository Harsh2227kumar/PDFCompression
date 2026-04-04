import type { Metadata } from "next";
import "./globals.css";
import Navbar from "../components/Navbar";
import ClientBackground from "../components/ClientBackground";

export const metadata: Metadata = {
  title: "File Compressor",
  description: "Lossless compression for PDF and Images.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app-container">
          {/* This is now a safe Client Component */}
          <ClientBackground />
          
          <Navbar />
          <div className="content-wrap">
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}