import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

function publicAssetPath(value) {
	if (
		typeof value !== "string" ||
		!value ||
		value.includes("\\") ||
		path.isAbsolute(value) ||
		value.split("/").some((part) => part === ".." || part === ".")
	)
		throw new Error("Invalid retained client asset path");
	return value;
}
async function optionalJson(file) {
	try {
		return JSON.parse(await fs.readFile(file, "utf8"));
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}
async function regularFiles(root, relative, accept, output) {
	const directory = path.join(root, relative);
	let entries;
	try {
		entries = await fs.readdir(directory, { withFileTypes: true });
	} catch (error) {
		if (error.code === "ENOENT") return;
		throw error;
	}
	for (const entry of entries) {
		const name = path.posix.join(relative, entry.name);
		if (entry.isSymbolicLink()) throw new Error("Retained client assets cannot contain symbolic links: " + name);
		if (entry.isDirectory()) {
			if (!["licenses", ".vite"].includes(name)) await regularFiles(root, name, accept, output);
		} else if (entry.isFile() && (await accept(name))) output.add(name);
	}
}
/** Carry files referenced by already-open clients across a static frontend release. */
export async function retainClientAssets(previousDirectory, outputDirectory) {
	const candidates = new Set();
	try {
		const previous = await fs.lstat(previousDirectory);
		if (!previous.isDirectory() || previous.isSymbolicLink()) throw new Error("Previous UI output must be a regular directory");
	} catch (error) {
		if (error.code === "ENOENT") return { available: false, files: 0, bytes: 0, sha256: null };
		throw error;
	}
	await regularFiles(previousDirectory, "_next", () => true, candidates);
	await regularFiles(
		previousDirectory,
		"",
		async (name) => {
			if (!name.endsWith(".txt")) return false;
			if (path.posix.basename(name).startsWith("__next.")) return true;
			// Next static-export RSC has an HTML sibling; ordinary public text may change.
			try {
				return (await fs.lstat(path.join(previousDirectory, name.slice(0, -4) + ".html"))).isFile();
			} catch (error) {
				if (error.code === "ENOENT") return false;
				throw error;
			}
		},
		candidates,
	);
	const previousManifest = await optionalJson(path.join(previousDirectory, ".vite/manifest.json"));
	if (previousManifest)
		for (const entry of Object.values(previousManifest)) {
			for (const name of [entry.file, ...(entry.css || []), ...(entry.assets || [])].filter(Boolean))
				candidates.add(publicAssetPath(name));
		}
	const retained = await optionalJson(path.join(previousDirectory, "retained-client-assets.json"));
	for (const entry of retained?.entries || []) candidates.add(publicAssetPath(entry.path));
	const entries = [],
		digest = crypto.createHash("sha256");
	let bytes = 0;
	for (const name of [...candidates].sort()) {
		publicAssetPath(name);
		const source = path.join(previousDirectory, name),
			destination = path.join(outputDirectory, name);
		// Never follow a link introduced by a nested asset directory or manifest.
		for (let relative = name; relative; relative = path.posix.dirname(relative) === "." ? "" : path.posix.dirname(relative)) {
			if ((await fs.lstat(path.join(previousDirectory, relative))).isSymbolicLink())
				throw new Error("Retained client assets cannot contain symbolic links: " + relative);
		}
		if (!(await fs.lstat(source)).isFile()) throw new Error("Retained client asset is not a file: " + name);
		const content = await fs.readFile(source);
		try {
			const present = await fs.readFile(destination);
			if (!present.equals(content)) throw new Error("Client asset name collision while retaining: " + name);
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
			await fs.mkdir(path.dirname(destination), { recursive: true });
			await fs.writeFile(destination, content, { flag: "wx" });
		}
		const sha256 = crypto.createHash("sha256").update(content).digest("hex");
		entries.push({ path: name, bytes: content.length, sha256 });
		bytes += content.length;
		digest.update(name + "\0" + sha256 + "\0");
	}
	const result = { available: true, files: entries.length, bytes, sha256: digest.digest("hex"), entries };
	await fs.writeFile(path.join(outputDirectory, "retained-client-assets.json"), JSON.stringify(result, null, 2));
	return { available: result.available, files: result.files, bytes: result.bytes, sha256: result.sha256 };
}
