import { fileURLToPath } from "node:url";
import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
	plugins: [vue()],
	base: command === "build" ? "./" : "/ui/",
	resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
	publicDir: "public",
	server: {
		port: 5174,
		strictPort: true,
		fs: {
			allow: [fileURLToPath(new URL(".", import.meta.url)), fileURLToPath(new URL("../../src/shared/", import.meta.url))],
		},
		proxy: {
			"^/(?!ui(?:/|$)|src/|@|node_modules/)": {
				target: process.env.DEV_API_TARGET || "http://127.0.0.1:4000",
				changeOrigin: false,
				ws: true,
			},
		},
	},
	build: {
		manifest: true,
		license: true,
		outDir: "out",
		emptyOutDir: true,
		target: ["es2020", "edge88", "firefox78", "chrome87", "safari14"],
		cssTarget: ["es2020", "edge88", "firefox78", "chrome87", "safari14"],
		rolldownOptions: {
			output: { codeSplitting: { groups: [{ name: "charts", test: /node_modules\/(?:echarts|zrender)\// }] } },
		},
	},
}));
