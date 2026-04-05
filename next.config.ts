import type { NextConfig } from "next";

const compressorApiBase =
	process.env.COMPRESSOR_API_URL ?? "http://localhost:3001";
const normalizedCompressorApiBase = compressorApiBase.replace(/\/$/, "");

const nextConfig: NextConfig = {
	async rewrites() {
		return [
			{
				source: "/api/compress-pdf",
				destination: `${normalizedCompressorApiBase}/compress-pdf`,
			},
			{
				source: "/api/compress-image",
				destination: `${normalizedCompressorApiBase}/compress-image`,
			},
		];
	},
};

export default nextConfig;
