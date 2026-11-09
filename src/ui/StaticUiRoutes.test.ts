import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import express from "express";
import request from "supertest";
import { registerStaticUiRoutes } from "./StaticUiRoutes";
import { pathPages } from "../shared/WebUiPaths";

jest.mock("../core/utils/logger", () => ({ createModuleLogger: () => ({ info: jest.fn(), warn: jest.fn() }) }));
const originalOut = process.env.UI_OUT_DIR;
let output: string;
beforeEach(async () => {
	output = await fs.mkdtemp(path.join(os.tmpdir(), "litellm-ui-routes-"));
	process.env.UI_OUT_DIR = output;
});
afterEach(async () => {
	if (originalOut === undefined) delete process.env.UI_OUT_DIR;
	else process.env.UI_OUT_DIR = originalOut;
	await fs.rm(output, { recursive: true, force: true });
});
async function artifact(name: string, body: string | Buffer): Promise<void> {
	const file = path.join(output, name);
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(file, body);
}
async function viteOutput(): Promise<void> {
	await artifact(
		"index.html",
		"<!doctype html><html><head><meta charset='utf-8'><base data-ui-base href='/ui/'></head><body>VUE_UI<script type='module' src='./assets/index-A1b2C3d4.js'></script></body></html>",
	);
	await artifact("assets/index-A1b2C3d4.js", 'console.log("vite fixture");');
	await artifact("assets/chunks/chart-Q9w8E7r6.css", "body{color:black}");
	await artifact("assets/runtime.js", 'console.log("fixed name");');
	await artifact("assets/app-manifest.js", 'console.log("fixed public filename");');
	await artifact(
		".vite/manifest.json",
		JSON.stringify({
			"index.html": {
				isEntry: true,
				file: "assets/index-A1b2C3d4.js",
				css: ["assets/chunks/chart-Q9w8E7r6.css"],
				assets: ["assets/logo.svg", "assets/runtime.js"],
			},
		}),
	);
	await artifact("assets/logo.svg", "<svg/>");
	await artifact("ui-base.js", "/* fixture bootstrap */");
	await artifact("favicon.ico", Buffer.from([0, 0, 1, 0]));
}
function appAt(mount = "") {
	const ui = express();
	registerStaticUiRoutes(ui);
	ui.use((_req, res) => {
		res.status(401).json({ error: "Authentication middleware reached" });
	});
	if (!mount) return ui;
	const outer = express();
	outer.use(mount, ui);
	return outer;
}
describe("public Vue/Vite static hosting", () => {
	it("serves the entry as uncached HTML and keeps the existing slash redirect and HEAD semantics", async () => {
		await viteOutput();
		const app = appAt();
		const redirect = await request(app).get("/ui?login=success").expect(301);
		expect(redirect.headers.location).toBe("/ui/?login=success");
		expect(redirect.headers["cache-control"]).toBe("no-store");
		const entry = await request(app).get("/ui/").expect(200);
		expect(entry.text).toContain("VUE_UI");
		expect(entry.headers["content-type"]).toMatch(/text\/html/);
		expect(entry.headers["cache-control"]).toBe("no-store");
		const head = await request(app).head("/ui/").expect(200);
		expect(head.text).toBeUndefined();
		expect(head.headers["content-length"]).toBe(entry.headers["content-length"]);
		expect(head.headers["cache-control"]).toBe("no-store");
	});
	it("serves every registered browser alias without consuming unknown URLs as HTML", async () => {
		await viteOutput();
		const app = appAt();
		for (const alias of Object.keys(pathPages)) {
			for (const ending of ["", "/"]) {
				const response = await request(app)
					.get("/ui/" + alias + ending)
					.expect(200);
				expect(response.text).toContain("VUE_UI");
				expect(response.headers["cache-control"]).toBe("no-store");
			}
		}
		for (const uri of [
			"/ui/unknown-page",
			"/ui/settings/unknown",
			"/ui/missing.js",
			"/ui/assets/missing.js",
			"/ui/assets/missing.js.map",
			"/ui/logs/missing.js",
			"/ui/assets",
			"/_next/missing.js",
			"/litellm-asset-prefix/_next/missing.js",
		]) {
			const response = await request(app).get(uri).expect(404);
			expect(response.headers["content-type"]).toMatch(/text\/plain/);
			expect(response.text).not.toContain("VUE_UI");
			expect(response.text).not.toContain("Authentication");
		}
		await request(app).get("/models").expect(401);
	});
	it("places one relative base first in the head for root, nested and trailing-slash pages", async () => {
		await viteOutput();
		const app = appAt("/gateway/nested");
		const cases = [
			["/ui/", "./"],
			["/ui/index.html", "./"],
			["/ui/login", "./"],
			["/ui/login/", "../"],
			["/ui/settings/router-settings", "../"],
			["/ui/settings/router-settings/", "../../"],
		] as const;
		for (const [uri, base] of cases) {
			const url = "https://example.test/gateway/nested" + uri;
			const response = await request(app)
				.get("/gateway/nested" + uri + "?tab=details")
				.expect(200);
			expect(response.text).toContain('<head><base data-ui-base href="' + base + '"><meta');
			expect(response.text.match(/<base\b/g)).toHaveLength(1);
			const assetUrl = new URL("./assets/index-A1b2C3d4.js", new URL(base, url));
			expect(assetUrl.pathname).toBe("/gateway/nested/ui/assets/index-A1b2C3d4.js");
			await request(app).get(assetUrl.pathname).expect(200);
			const head = await request(app)
				.head("/gateway/nested" + uri)
				.expect(200);
			expect(head.text).toBeUndefined();
			expect(head.headers["content-length"]).toBe(response.headers["content-length"]);
		}
	});
	it("caches only fingerprinted Vite resources indefinitely", async () => {
		await viteOutput();
		const app = appAt();
		for (const uri of ["/ui/assets/index-A1b2C3d4.js", "/ui/assets/chunks/chart-Q9w8E7r6.css"]) {
			const response = await request(app).get(uri).expect(200);
			expect(response.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
			const head = await request(app).head(uri).expect(200);
			expect(head.headers["cache-control"]).toBe(response.headers["cache-control"]);
			expect(head.text).toBeUndefined();
		}
		for (const uri of ["/ui/assets/runtime.js", "/ui/assets/logo.svg", "/ui/assets/app-manifest.js"]) {
			const response = await request(app).get(uri).expect(200);
			expect(response.headers["cache-control"]).toBe("public, max-age=0");
		}
		await request(app).head("/ui/assets/unknown.js").expect(404);
	});
	it("falls back to revalidation when the Vite manifest is missing or malformed", async () => {
		await viteOutput();
		await fs.unlink(path.join(output, ".vite/manifest.json"));
		let response = await request(appAt()).get("/ui/assets/index-A1b2C3d4.js").expect(200);
		expect(response.headers["cache-control"]).toBe("public, max-age=0");
		await artifact(".vite/manifest.json", "{invalid");
		response = await request(appAt()).get("/ui/assets/index-A1b2C3d4.js").expect(200);
		expect(response.headers["cache-control"]).toBe("public, max-age=0");
	});
	it("serves the same fixed-name bootstrap beneath known route directories while missing resources remain public", async () => {
		await viteOutput();
		const app = appAt();
		for (const uri of [
			"/ui/ui-base.js",
			"/ui/settings/ui-base.js",
			"/ui/settings/router-settings/ui-base.js",
			"/ui/settings/admin-settings/ui-base.js",
			"/ui/chat/ui-base.js",
		]) {
			const response = await request(app).get(uri).expect(200);
			expect(response.text).toBe("/* fixture bootstrap */");
			expect(response.headers["content-type"]).toMatch(/javascript/);
			expect(response.headers["cache-control"]).toBe("no-store");
			await request(app).head(uri).expect(200);
		}
		await request(app).get("/ui/no-such-page/ui-base.js").expect(404);
		await fs.unlink(path.join(output, "ui-base.js"));
		await request(app).get("/ui/settings/ui-base.js").expect(404);
		await request(app).get("/ui/ui-base.js").expect(404);
		await fs.unlink(path.join(output, "favicon.ico"));
		await request(app).get("/favicon.ico").expect(404);
	});
	it("preserves all relative paths when the UI application has a nested Express mount", async () => {
		await viteOutput();
		const app = appAt("/gateway/nested");
		await request(app).get("/gateway/nested/ui").expect(301).expect("Location", "/gateway/nested/ui/");
		for (const uri of ["/ui/", "/ui/settings/ui-theme", "/ui/settings/admin-settings/"]) {
			const response = await request(app)
				.get("/gateway/nested" + uri)
				.expect(200);
			expect(response.text).toContain("VUE_UI");
		}
		await request(app).get("/gateway/nested/ui/assets/index-A1b2C3d4.js").expect(200);
		await request(app).get("/gateway/nested/ui/settings/ui-base.js").expect(200);
		await request(app).get("/gateway/nested/ui/settings/router-settings/favicon.ico").expect(200);
		await request(app).head("/gateway/nested/ui/settings/ui-theme").expect(200);
		await request(app).get("/gateway/nested/ui/assets/no-such.js").expect(404);
		await request(app).get("/gateway/nested/models").expect(401);
	});
	it("normalizes a relative UI_OUT_DIR without exposing a file outside the artifact root", async () => {
		await viteOutput();
		process.env.UI_OUT_DIR = path.relative(process.cwd(), output);
		const app = appAt();
		await request(app).get("/ui/").expect(200);
		await request(app).get("/ui/%2e%2e%2foutside.js").expect(404);
	});
	it("keeps the API available and reports missing UI assets publicly for an incomplete output", async () => {
		await artifact("index.html", "incomplete");
		const app = appAt();
		await request(app).get("/ui/").expect(404);
		await request(app).get("/ui/assets/missing.js").expect(404);
		await request(app).head("/_next/missing.js").expect(404);
		await request(app).get("/favicon.ico").expect(404);
		await request(app).get("/models").expect(401);
	});
});
describe("existing Next export compatibility", () => {
	beforeEach(async () => {
		await artifact("index.html", "<!doctype html><body>NEXT_UI</body>");
		await artifact("_next/static/chunks/app.js", "/* existing Next chunk */");
		await artifact("assets/logo.svg", "<svg/>");
		await artifact("login.html", "<!doctype html><body>NEXT_LOGIN</body>");
		await artifact("index.txt", "NEXT_ROOT_RSC");
		await artifact("login.txt", "NEXT_LOGIN_RSC");
		await artifact("__next.tree.payload.txt", "NEXT_SEGMENT_RSC");
		await artifact("favicon.ico", Buffer.from([0, 0, 1, 0]));
	});
	it("retains both public Next asset prefixes and ends missing chunks before authentication", async () => {
		const app = appAt();
		for (const uri of ["/_next/static/chunks/app.js", "/litellm-asset-prefix/_next/static/chunks/app.js"]) {
			const response = await request(app).get(uri).expect(200);
			expect(response.text).toBe("/* existing Next chunk */");
			expect(response.headers["cache-control"]).toContain("immutable");
			await request(app).head(uri).expect(200);
			await request(app)
				.get(uri + ".map")
				.expect(404);
		}
	});
	it("maps exported HTML files without changing Next into a generic SPA fallback", async () => {
		const app = appAt();
		for (const uri of ["/ui/login", "/ui/login/", "/ui/login.html"]) {
			const response = await request(app).get(uri).expect(200);
			expect(response.text).toContain("NEXT_LOGIN");
			expect(response.headers["cache-control"]).toBe("no-store");
		}
		await request(app).get("/ui/models-and-endpoints").expect(404);
		await request(app).get("/ui/unknown.js").expect(404);
		const response = await request(app).get("/ui/").expect(200);
		expect(response.text).toContain("NEXT_UI");
		expect(response.headers["cache-control"]).toBe("no-store");
	});
	it("gives a verified Vite entry precedence over coexisting old HTML, chunks and RSC payloads", async () => {
		await viteOutput();
		const app = appAt();
		for (const uri of ["/ui/login", "/ui/login/", "/ui/settings/ui-theme"]) {
			const response = await request(app).get(uri).expect(200);
			expect(response.text).toContain("VUE_UI");
			expect(response.text).not.toContain("NEXT_LOGIN");
			const base = uri.endsWith("/") || uri.includes("/settings/") ? "../" : "./";
			expect(response.text).toContain('<head><base data-ui-base href="' + base + '">');
			expect(response.headers["cache-control"]).toBe("no-store");
		}
		await request(app).get("/_next/static/chunks/app.js").expect(200);
		expect((await request(app).get("/ui.txt").expect(200)).text).toBe("NEXT_ROOT_RSC");
		await request(app).get("/ui/assets/index-A1b2C3d4.js").expect(200).expect("Cache-Control", "public, max-age=31536000, immutable");
		await artifact(".vite/manifest.json", JSON.stringify({ "index.html": { isEntry: true, file: "assets/missing-A1b2C3d4.js" } }));
		const incomplete = await request(appAt()).get("/ui/login").expect(200);
		expect(incomplete.text).toContain("NEXT_LOGIN");
	});
	it("retains GET/HEAD root RSC payloads and favicon aliases below nested mounts", async () => {
		const app = appAt("/prefix");
		const aliases = [
			["/ui.txt", "NEXT_ROOT_RSC"],
			["/login.txt", "NEXT_LOGIN_RSC"],
			["/__next.tree.payload.txt", "NEXT_SEGMENT_RSC"],
		];
		for (const [uri, body] of aliases) {
			const response = await request(app)
				.get("/prefix" + uri)
				.expect(200);
			expect(response.text).toBe(body);
			const head = await request(app)
				.head("/prefix" + uri)
				.expect(200);
			expect(head.text).toBeUndefined();
		}
		for (const uri of ["/favicon.ico", "/ui/favicon.ico", "/ui/login/favicon.ico"])
			await request(app)
				.get("/prefix" + uri)
				.expect(200);
		await request(app).get("/prefix/no-such.txt").expect(404);
	});
});
