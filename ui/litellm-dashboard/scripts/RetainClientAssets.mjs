import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

/**
 * 兼容资源最多向前保留的发布代数。
 *
 * 每一版都会把上一版的 retained 清单继续带下去，早期实现没有上限，`out/` 在几十次发布后
 * 累积到上万文件（镜像里出现过 392MB 的静态目录）。保留窗口只需覆盖「还开着旧页面的客户端」
 * 这一真实场景，超过窗口就重新开始计数，让目录大小回到常数级。
 */
export const MAX_RETAINED_GENERATIONS = 8;
/** 兼容资源总量上限；超过时放弃继承旧清单，只保留本版 manifest 引用的文件。 */
export const MAX_RETAINED_BYTES = 192 * 1024 * 1024;

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
async function statOrNull(file) {
	try {
		return await fs.lstat(file);
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
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
	const generations = (Number.isFinite(retained?.generations) ? retained.generations : 0) + 1;
	const inheritedBytes = (retained?.entries || []).reduce((sum, entry) => sum + (Number(entry.bytes) || 0), 0);
	// 只在窗口内继承：代数超限或历史体量失控时重新开始，避免兼容资源无限增长。
	const inheritPrevious = generations <= MAX_RETAINED_GENERATIONS && inheritedBytes <= MAX_RETAINED_BYTES;
	if (inheritPrevious) for (const entry of retained?.entries || []) candidates.add(publicAssetPath(entry.path));
	const entries = [],
		digest = crypto.createHash("sha256");
	let bytes = 0;
	for (const name of [...candidates].sort()) {
		publicAssetPath(name);
		const source = path.join(previousDirectory, name),
			destination = path.join(outputDirectory, name);
		// 上一版清单可能列出早已清理掉的兼容资源（例如旧 Next 导出的 `__next.*` 占位），
		// 目录遍历也可能与外部清理并发。缺失即跳过：它是可选的历史资产，不能让之后每次构建都失败。
		const present = await statOrNull(source);
		if (present === null) continue;
		// Never follow a link introduced by a nested asset directory or manifest.
		let linked = false;
		for (let relative = name; relative; relative = path.posix.dirname(relative) === "." ? "" : path.posix.dirname(relative)) {
			const ancestor = await statOrNull(path.join(previousDirectory, relative));
			if (ancestor === null) {
				linked = true;
				break;
			}
			if (ancestor.isSymbolicLink()) throw new Error("Retained client assets cannot contain symbolic links: " + relative);
		}
		if (linked) continue;
		if (!present.isFile()) throw new Error("Retained client asset is not a file: " + name);
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
	const result = {
		available: true,
		generations: inheritPrevious ? generations : 1,
		files: entries.length,
		bytes,
		sha256: digest.digest("hex"),
		entries,
	};
	await fs.writeFile(path.join(outputDirectory, "retained-client-assets.json"), JSON.stringify(result, null, 2));
	return { available: result.available, files: result.files, bytes: result.bytes, sha256: result.sha256 };
}
