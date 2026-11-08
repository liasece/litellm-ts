import { defineConfig } from "@playwright/test";
export default defineConfig({
	testDir: "./tests/platform-ui",
	outputDir: "../../.artifacts/frontend-vue/browser-tests/usage-chart",
	testMatch: "UsageCharts.spec.ts",
	workers: 1,
	use: {
		baseURL: "http://127.0.0.1:5196",
		browserName: "chromium",
		launchOptions: { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined },
	},
	webServer: {
		command: "npm run dev -- --host 127.0.0.1 --port 5196",
		url: "http://127.0.0.1:5196/ui/tests/platform-ui/usage-chart.html",
		reuseExistingServer: false,
		timeout: 30000,
	},
	reporter: "list",
});
