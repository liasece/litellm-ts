import { defineConfig } from "@playwright/test";

export default defineConfig({
	testDir: "./tests/platform-ui",
	testMatch: "*.spec.ts",
	outputDir: "../../.artifacts/frontend-vue/browser-tests/platform-ui",
	fullyParallel: true,
	workers: 2,
	use: {
		baseURL: "http://127.0.0.1:5187",
		browserName: "chromium",
		launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined },
	},
	webServer: {
		command: "npm run dev -- --host 127.0.0.1 --port 5187",
		url: "http://127.0.0.1:5187/ui/tests/platform-ui/controls.html",
		reuseExistingServer: false,
		timeout: 30_000,
	},
	reporter: "list",
});
