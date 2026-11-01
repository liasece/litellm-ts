import path from "path";
import { fileURLToPath } from "url";

/** @type {import('next').NextConfig} */
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const nextConfig = {
	output: "export",
	basePath: "",
	assetPrefix: "/litellm-asset-prefix",
	turbopack: {
		// The alias editor shares time-window rules with the backend under src/shared.
		root: path.resolve(__dirname, "../.."),
	},
};

export default nextConfig;
