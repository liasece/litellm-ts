/**
 * Public static hosting for the Next export and the Vue/Vite Dashboard.
 * The configured output remains read-only; recognized browser paths receive HTML,
 * while missing files stop here before authenticated API middleware.
 */
import path from "node:path";
import fs from "node:fs";
import type { ServerResponse } from "node:http";
import express from "express";
import type { Express, NextFunction, Request, Response } from "express";
import { createModuleLogger } from "../core/utils/logger";
import { isKnownWebUiPagePath, isKnownWebUiPathPrefix } from "../shared/WebUiPaths";

const logger = createModuleLogger("UI");
const DEFAULT_UI_OUT_DIR = "/app/ui/out";
const ASSET_PREFIX = "/litellm-asset-prefix";
const IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
const FINGERPRINTED_ASSET = /-[a-z0-9_-]{8,32}\.[a-z0-9]+(?:\.map)?$/i;

/**
 * Resolve the explicitly configured output before the existing image/development defaults.
 * @returns Absolute path to the UI output directory.
 */
function resolveUiOutDir(): string {
	const configured = process.env.UI_OUT_DIR;
	if (configured) {
		return path.resolve(configured);
	}
	if (fs.existsSync(DEFAULT_UI_OUT_DIR)) {
		return DEFAULT_UI_OUT_DIR;
	}
	return path.join(process.cwd(), "ui", "litellm-dashboard", "out");
}

/**
 * Ignore incomplete outputs and directories where a file is required.
 * @param filePath - Candidate artifact path.
 * @returns Whether it is a readable filesystem file.
 */
function isFile(filePath: string): boolean {
	try {
		return fs.statSync(filePath).isFile();
	} catch {
		return false;
	}
}

/**
 * Detect an artifact directory without failing API startup for missing outputs.
 * @param directory - Candidate directory.
 * @returns Whether the directory exists.
 */
function isDirectory(directory: string): boolean {
	try {
		return fs.statSync(directory).isDirectory();
	} catch {
		return false;
	}
}

/**
 * Decode a relative request path without allowing fallback handlers to escape their output.
 * @param pathname - Request pathname relative to the current Express mount.
 * @returns A normalized relative path, or null for invalid/hidden paths.
 */
function relativeUiPath(pathname: string): string | null {
	try {
		const clean = decodeURIComponent(pathname).replace(/^\/+|\/+$/g, "");
		if (clean.includes("\\") || clean.includes("\0") || clean.split("/").some((part) => part.startsWith("."))) {
			return null;
		}
		return clean;
	} catch {
		return null;
	}
}

/**
 * Keep missing static requests public, including when authentication follows this middleware.
 * @param req - Static request.
 * @param res - Public response.
 */
function missingAsset(req: Request, res: Response): void {
	res.setHeader("Cache-Control", "no-store");
	res.status(404).type("text/plain").send("Not Found");
}

interface ViteOutputMetadata {
	validEntry: boolean;
	immutableAssets: ReadonlySet<string>;
}

/**
 * Verify a manifest asset path before resolving it below the output root.
 * @param value - Vite manifest file value.
 * @returns Whether it is a relative asset path.
 */
function isManifestAssetPath(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.startsWith("assets/") &&
		!value.includes("\\") &&
		!value.split("/").some((part) => part === ".." || part === ".")
	);
}

/**
 * Verify Vite's index entry independently from optional legacy _next/RSC assets.
 * @param uiOutDir - Artifact root.
 * @returns Entry validity and fingerprinted files eligible for immutable caching.
 */
function readViteOutputMetadata(uiOutDir: string): ViteOutputMetadata {
	const assets = new Set<string>();
	let validEntry = false;
	try {
		const manifest: unknown = JSON.parse(fs.readFileSync(path.join(uiOutDir, ".vite", "manifest.json"), "utf8"));
		if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
			return { validEntry: false, immutableAssets: assets };
		}
		for (const [name, entry] of Object.entries(manifest)) {
			if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
				continue;
			}
			const record = entry as Record<string, unknown>;
			if (
				record.isEntry === true &&
				(name === "index.html" || record.src === "index.html") &&
				isManifestAssetPath(record.file) &&
				/\.m?js$/.test(record.file) &&
				isFile(path.resolve(uiOutDir, record.file))
			) {
				validEntry = true;
			}
			const files = [
				record.file,
				...(Array.isArray(record.css) ? record.css : []),
				...(Array.isArray(record.assets) ? record.assets : []),
			];
			for (const value of files) {
				if (isManifestAssetPath(value) && FINGERPRINTED_ASSET.test(path.basename(value))) {
					assets.add(path.resolve(uiOutDir, value));
				}
			}
		}
	} catch {
		// Missing or invalid build metadata must never permanently cache a fixed-name public asset.
	}
	return { validEntry: validEntry, immutableAssets: validEntry ? assets : new Set<string>() };
}

/**
 * Cache HTML/bootstrap per navigation and only cache fingerprinted Vite assets indefinitely.
 * @param res - File response.
 * @param filePath - Absolute file path.
 * @param uiOutDir - Absolute artifact root.
 * @param immutableAssets - Fingerprinted files verified against the emitted Vite graph.
 */
function setUiCacheHeaders(res: ServerResponse, filePath: string, uiOutDir: string, immutableAssets: ReadonlySet<string>): void {
	const extension = path.extname(filePath).toLowerCase();
	if (extension === ".html" || path.basename(filePath) === "ui-base.js") {
		res.setHeader("Cache-Control", "no-store");
		return;
	}
	const assetPath = path.relative(path.join(uiOutDir, "assets"), filePath);
	const inAssets = assetPath !== "" && !assetPath.startsWith("..") && !path.isAbsolute(assetPath);
	res.setHeader("Cache-Control", inAssets && immutableAssets.has(path.resolve(filePath)) ? IMMUTABLE_CACHE : "public, max-age=0");
}

/**
 * Render a relative base before any preload can resolve an asset from a deep browser path.
 * The path is relative to the /ui mount, so reverse proxies may freely strip their own prefix.
 * @param template - Vite entry HTML.
 * @param pathname - Browser pathname within the current UI mount.
 * @param clean - Validated page path without surrounding slashes.
 * @returns HTML whose first head element freezes the correct asset base.
 */
function renderVueHtml(template: string, pathname: string, clean: string): string {
	const depth = clean === "" || clean === "index.html" ? 0 : clean.split("/").length - (pathname.endsWith("/") ? 0 : 1);
	const base = depth === 0 ? "./" : "../".repeat(depth);
	const baseElement = '<base data-ui-base href="' + base + '">';
	const withoutMarker = template.replace(/<base\b(?=[^>]*\bdata-ui-base(?:\s|=|>))[^>]*>/gi, "");
	if (/<head\b[^>]*>/i.test(withoutMarker)) {
		return withoutMarker.replace(/<head\b[^>]*>/i, (head) => head + baseElement);
	}
	return withoutMarker.replace(/<html\b[^>]*>/i, (html) => html + "<head>" + baseElement + "</head>");
}

/**
 * Next export keeps extensionless pages as name.html without a generic SPA fallback.
 * @param uiOutDir - Artifact root.
 * @returns Extensionless HTML fallback middleware.
 */
function createUiHtmlFallback(uiOutDir: string): (req: Request, res: Response, next: NextFunction) => void {
	return (req, res, next): void => {
		if (req.method !== "GET" && req.method !== "HEAD") {
			next();
			return;
		}
		const clean = relativeUiPath(req.path);
		if (clean === null || clean === "" || clean.startsWith("_next")) {
			next();
			return;
		}
		const extension = path.extname(clean);
		const exportedHtml = path.join(uiOutDir, extension === "" ? clean + ".html" : clean);
		if ((extension === "" || extension === ".html") && isFile(exportedHtml)) {
			res.setHeader("Cache-Control", "no-store");
			res.sendFile(exportedHtml);
			return;
		}
		next();
	};
}

/**
 * Preserve Next's public root RSC payload aliases, including /ui.txt -> index.txt.
 * @param uiOutDir - Artifact root.
 * @returns Root RSC fallback middleware.
 */
function createRootTextFallback(uiOutDir: string): (req: Request, res: Response, next: NextFunction) => void {
	return (req, res, next): void => {
		if (req.method !== "GET" && req.method !== "HEAD") {
			next();
			return;
		}
		const clean = relativeUiPath(req.path);
		if (clean === null || !clean.endsWith(".txt") || clean.includes("/")) {
			next();
			return;
		}
		const fileName = clean === "ui.txt" ? "index.txt" : clean;
		const filePath = path.join(uiOutDir, fileName);
		if (!isFile(filePath)) {
			missingAsset(req, res);
			return;
		}
		res.sendFile(filePath);
	};
}

/**
 * Serve unchanged favicon aliases and known nested bootstrap aliases for a relative-base Vite entry.
 * @param app - Express application, potentially mounted below another application.
 * @param uiOutDir - Artifact root.
 */
function registerPublicFileAliases(app: Express, uiOutDir: string): void {
	const sendFavicon = (req: Request, res: Response): void => {
		const filePath = path.join(uiOutDir, "favicon.ico");
		if (!isFile(filePath)) {
			missingAsset(req, res);
			return;
		}
		res.sendFile(filePath);
	};
	app.get("/favicon.ico", sendFavicon);
	app.get("/ui/favicon.ico", sendFavicon);
	app.get("/ui/*/favicon.ico", sendFavicon);
	app.get("/ui/*/ui-base.js", (req: Request, res: Response): void => {
		const clean = relativeUiPath(req.path);
		const directory = clean?.slice("ui/".length, -"/ui-base.js".length);
		const filePath = path.join(uiOutDir, "ui-base.js");
		if (directory === undefined || !isKnownWebUiPathPrefix(directory) || !isFile(filePath)) {
			missingAsset(req, res);
			return;
		}
		res.setHeader("Cache-Control", "no-store");
		res.sendFile(filePath);
	});
}

/**
 * Register public UI files before authentication without changing the configured artifact directory.
 * @param app - Express application.
 */
export function registerStaticUiRoutes(app: Express): void {
	const uiOutDir = resolveUiOutDir();
	const nextOutput = isDirectory(path.join(uiOutDir, "_next"));
	const viteMetadata = readViteOutputMetadata(uiOutDir);
	const viteOutput = viteMetadata.validEntry || (!nextOutput && isDirectory(path.join(uiOutDir, "assets")));
	const ready = isFile(path.join(uiOutDir, "index.html")) && (nextOutput || viteOutput);
	if (!ready) {
		logger.warn("WebUI 静态产物不可用：" + uiOutDir + "（缺少 index.html 及 _next/assets）。仅 API 路由可用。");
		app.use(["/_next", ASSET_PREFIX + "/_next", "/ui"], missingAsset);
		app.get("/favicon.ico", missingAsset);
		return;
	}
	const immutableAssets = viteMetadata.immutableAssets;
	const nextOptions = { fallthrough: true, immutable: true, maxAge: "1y" } as const;
	app.use("/_next", express.static(path.join(uiOutDir, "_next"), nextOptions), missingAsset);
	app.use(ASSET_PREFIX + "/_next", express.static(path.join(uiOutDir, "_next"), nextOptions), missingAsset);
	registerPublicFileAliases(app, uiOutDir);
	app.use(createRootTextFallback(uiOutDir));
	if (viteOutput) {
		app.use(
			"/ui/assets",
			express.static(path.join(uiOutDir, "assets"), {
				fallthrough: true,
				index: false,
				redirect: false,
				setHeaders: (res, filePath) => setUiCacheHeaders(res, filePath, uiOutDir, immutableAssets),
			}),
			missingAsset,
		);
	}
	if (viteOutput) {
		const template = fs.readFileSync(path.join(uiOutDir, "index.html"), "utf8");
		app.use("/ui", (req: Request, res: Response, next: NextFunction): void => {
			const clean = relativeUiPath(req.path);
			const missingRootSlash = clean === "" && !req.originalUrl.replace(/\?.*$/, "").endsWith("/");
			if ((req.method === "GET" || req.method === "HEAD") && clean !== null && !missingRootSlash && isKnownWebUiPagePath(clean)) {
				res.setHeader("Cache-Control", "no-store");
				res.type("html").send(renderVueHtml(template, req.path, clean));
				return;
			}
			next();
		});
	}
	app.use(
		"/ui",
		(req: Request, res: Response, next: NextFunction): void => {
			if ((req.method === "GET" || req.method === "HEAD") && !path.extname(req.path)) {
				res.setHeader("Cache-Control", "no-store");
			}
			next();
		},
		express.static(uiOutDir, {
			fallthrough: true,
			index: "index.html",
			setHeaders: (res, filePath) => setUiCacheHeaders(res, filePath, uiOutDir, immutableAssets),
		}),
	);
	app.use("/ui", createUiHtmlFallback(uiOutDir), missingAsset);
	logger.info("WebUI 静态路由已注册：" + uiOutDir + "（/_next, " + ASSET_PREFIX + "/_next, /ui）");
}
