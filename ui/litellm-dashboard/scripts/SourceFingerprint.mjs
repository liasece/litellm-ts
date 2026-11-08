import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export async function sourceFingerprint(root) {
	const files = [];
	async function visit(directory) {
		for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
			const full = path.join(directory, entry.name);
			if (entry.isDirectory()) await visit(full);
			else if (
				/\.(?:ts|tsx|js|jsx|mjs|cjs|vue|css|scss|json|html|svg|png|jpe?g|webp|gif|avif|woff2?|ttf|otf|wasm|txt|license|notice)$/.test(
					entry.name.toLowerCase(),
				)
			)
				files.push(full);
		}
	}
	await visit(path.join(root, "src"));
	await visit(path.resolve(root, "../../src/shared"));
	try {
		await visit(path.join(root, "public"));
	} catch (error) {
		if (error.code !== "ENOENT") throw error;
	}
	for (const name of [
		"package.json",
		"package-lock.json",
		"vite.config.ts",
		"tsconfig.json",
		"index.html",
		"scripts/BuildRuntime.mjs",
		"scripts/SourceFingerprint.mjs",
		"scripts/RetainClientAssets.mjs",
	])
		files.push(path.join(root, name));
	files.sort();
	const digest = crypto.createHash("sha256");
	for (const file of files) {
		const relative = path.relative(root, file);
		digest.update(relative + "\0");
		digest.update(await fs.readFile(file));
		digest.update("\0");
	}
	return { sha256: digest.digest("hex"), files: files.length };
}
