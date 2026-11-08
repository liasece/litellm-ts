import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { retainClientAssets } from "./RetainClientAssets.mjs";
const temporary = [];
afterEach(async () => {
	for (const directory of temporary.splice(0)) await fs.rm(directory, { recursive: true, force: true });
});
async function directory() {
	const value = await fs.mkdtemp(path.join(os.tmpdir(), "litellm-retain-client-"));
	temporary.push(value);
	return value;
}
async function write(root, name, contents) {
	await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
	await fs.writeFile(path.join(root, name), contents);
}
describe("cached client assets across frontend releases", () => {
	it("keeps Next modules and RSC bytes while the new Vue entry remains authoritative", async () => {
		const previous = await directory(),
			next = await directory();
		await write(previous, "_next/static/chunks/old-abc.js", "old client chunk");
		await write(previous, "logs.txt", "old RSC");
		await write(previous, "logs.html", "old log page");
		await write(previous, "robots.txt", "old crawler rules");
		await write(next, "robots.txt", "new crawler rules");
		await write(previous, "index.html", "old HTML");
		await write(previous, "licenses/source.txt", "old notice");
		await write(next, "index.html", "new Vue HTML");
		const retained = await retainClientAssets(previous, next);
		expect(retained.files).toBe(2);
		expect(await fs.readFile(path.join(next, "robots.txt"), "utf8")).toBe("new crawler rules");
		expect(await fs.readFile(path.join(next, "_next/static/chunks/old-abc.js"), "utf8")).toBe("old client chunk");
		expect(await fs.readFile(path.join(next, "logs.txt"), "utf8")).toBe("old RSC");
		expect(await fs.readFile(path.join(next, "index.html"), "utf8")).toBe("new Vue HTML");
	});
	it("carries both older retained modules and the previous Vue manifest through a later release", async () => {
		const old = await directory(),
			previous = await directory(),
			next = await directory();
		await write(old, "_next/static/old.js", "old React");
		await retainClientAssets(old, previous);
		await write(previous, "assets/main-a1b2c3d4.js", "previous Vue");
		await write(previous, ".vite/manifest.json", JSON.stringify({ "index.html": { file: "assets/main-a1b2c3d4.js" } }));
		await write(next, "assets/main-new.js", "new Vue");
		expect((await retainClientAssets(previous, next)).files).toBe(2);
		expect(await fs.readFile(path.join(next, "_next/static/old.js"), "utf8")).toBe("old React");
		expect(await fs.readFile(path.join(next, "assets/main-a1b2c3d4.js"), "utf8")).toBe("previous Vue");
		expect(await fs.readFile(path.join(next, "assets/main-new.js"), "utf8")).toBe("new Vue");
	});
	it("does not require a previous artifact for a fresh installation", async () => {
		const next = await directory();
		expect(await retainClientAssets(path.join(next, "missing"), next)).toEqual({ available: false, files: 0, bytes: 0, sha256: null });
	});
	it("rejects changed bytes under a cached asset URL", async () => {
		const previous = await directory(),
			next = await directory();
		await write(previous, "_next/static/old.js", "old");
		await write(next, "_next/static/old.js", "different");
		await expect(retainClientAssets(previous, next)).rejects.toThrow("collision");
	});
	it("rejects manifest traversal and symbolic links", async () => {
		const previous = await directory(),
			next = await directory();
		await write(previous, ".vite/manifest.json", JSON.stringify({ bad: { file: "../outside.js" } }));
		await expect(retainClientAssets(previous, next)).rejects.toThrow("Invalid");
		await fs.rm(path.join(previous, ".vite/manifest.json"));
		await write(previous, "_next/static/old.js", "old");
		await fs.symlink("old.js", path.join(previous, "_next/static/link.js"));
		await expect(retainClientAssets(previous, next)).rejects.toThrow("symbolic links");
	});
});
