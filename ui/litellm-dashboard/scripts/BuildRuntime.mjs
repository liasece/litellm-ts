import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { sourceFingerprint } from "./SourceFingerprint.mjs";
import { retainClientAssets } from "./RetainClientAssets.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
async function copySourceLicenses(directory, licenseRoot) {
	for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
		const source = path.join(directory, entry.name);
		if (entry.isDirectory()) await copySourceLicenses(source, licenseRoot);
		else if (/(?:license|notice)(?:\.[a-z]+)?$/i.test(entry.name)) {
			const destination = path.join(licenseRoot, "source", path.relative(path.join(root, "src"), source));
			await fs.mkdir(path.dirname(destination), { recursive: true });
			await fs.copyFile(source, destination);
		}
	}
}
const initial = await sourceFingerprint(root);
const compatibilityDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "litellm-client-assets-"));
try {
	let priorClientAssets = await retainClientAssets(path.resolve(root, "../out"), compatibilityDirectory);
	// A full image build may receive the last package artifact instead of ui/out.
	if (!priorClientAssets.available) priorClientAssets = await retainClientAssets(path.join(root, "out"), compatibilityDirectory);
	for (const args of [
		[path.join(root, "node_modules/vue-tsc/bin/vue-tsc.js"), "--noEmit"],
		[path.join(root, "node_modules/vite/bin/vite.js"), "build"],
	]) {
		const result = spawnSync(process.execPath, args, { cwd: root, stdio: "inherit" });
		if (result.error) throw result.error;
		if (result.status !== 0) throw new Error("Frontend build failed with status " + (result.status ?? 1));
	}
	// Keep notices for bundled dependencies and source-ported native assets in the
	// distributed artifact, including when the host only ships the static output.
	const licenseRoot = path.join(root, "out/licenses");
	await fs.mkdir(licenseRoot, { recursive: true });
	await fs.copyFile(path.join(root, "out/.vite/license.md"), path.join(licenseRoot, "dependencies.md"));

	await copySourceLicenses(path.join(root, "src"), licenseRoot);
	const retainedClientAssets = priorClientAssets.available
		? await retainClientAssets(compatibilityDirectory, path.join(root, "out"))
		: priorClientAssets;
	const final = await sourceFingerprint(root);
	if (initial.sha256 !== final.sha256)
		throw new Error("Vue sources changed while building. Rebuild the completed source before acceptance.");
	await fs.writeFile(
		path.join(root, "out/build-provenance.json"),
		JSON.stringify(
			{
				builtAt: new Date().toISOString(),
				node: process.version,
				retainedClientAssets,
				...final,
			},
			null,
			2,
		),
	);
	console.log("Recorded Vue build provenance: " + final.files + " input files");
} finally {
	await fs.rm(compatibilityDirectory, { recursive: true, force: true });
}
