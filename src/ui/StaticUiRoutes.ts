/**
 * WebUI 静态资源挂载
 *
 * 负责把 Next.js 打包后的 WebUI 静态产物挂载到 Express 路由上：
 * - /_next  — Next.js 静态资源（chunk、图片、字体等）
 * - /litellm-asset-prefix/_next — 通过资产前缀访问的资源（向后兼容）
 * - /ui — WebUI 入口（index.html）
 *
 * 注意：
 * - 静态产物由 ui-builder 阶段在 Dockerfile 中生成到 UI_OUT_DIR
 * - 本模块不修改 WebUI 业务源码，仅负责运行时挂载
 * - /ui 路径无鉴权（与 Python LiteLLM 行为一致）
 */

import path from "node:path";
import fs from "node:fs";
import express, { type Express, type NextFunction, type Request, type Response } from "express";
import { createModuleLogger } from "../core/utils/logger";

const logger = createModuleLogger("UI");

/** 默认 UI 静态产物目录（Docker 镜像内路径） */
const DEFAULT_UI_OUT_DIR = "/app/ui/out";

/** WebUI 资产前缀（与 Next.js next.config.mjs 中的 assetPrefix 一致） */
const ASSET_PREFIX = "/litellm-asset-prefix";

/**
 * 解析 UI 静态产物目录
 * 优先级：UI_OUT_DIR 环境变量 > 默认 /app/ui/out
 * 开发/测试环境如果默认目录不存在，回退到 process.cwd()/ui/litellm-dashboard/out
 */
function resolveUiOutDir(): string {
	const envDir = process.env.UI_OUT_DIR;
	if (envDir && envDir.length > 0) {
		return envDir;
	}
	const defaultDir = DEFAULT_UI_OUT_DIR;
	if (fs.existsSync(defaultDir)) {
		return defaultDir;
	}
	return path.join(process.cwd(), "ui", "litellm-dashboard", "out");
}

/**
 * 校验 UI 静态产物是否就绪
 * 检查 index.html 与 _next 目录是否存在
 * @param uiOutDir - UI 静态产物目录
 * @returns 是否就绪
 */
function validateUiOutDir(uiOutDir: string): boolean {
	const indexHtml = path.join(uiOutDir, "index.html");
	const nextDir = path.join(uiOutDir, "_next");
	return fs.existsSync(indexHtml) && fs.existsSync(nextDir);
}

/**
 * Next export 会生成 login.html；Python LiteLLM 启动时会把它整理成 login/index.html。
 * TS 端运行时保持产物只读，不改文件，改为等价地把 /ui/login/ 映射到 login.html。
 * @param uiOutDir - UI 静态产物目录
 */
function createUiHtmlFallback(uiOutDir: string): (req: Request, res: Response, next: NextFunction) => void {
	return (req: Request, res: Response, next: NextFunction): void => {
		if (req.method !== "GET" && req.method !== "HEAD") {
			next();
			return;
		}

		const cleanPath = req.path.replace(/^\/+|\/+$/g, "");
		if (cleanPath.length === 0 || cleanPath.startsWith("_next") || cleanPath.includes("..")) {
			next();
			return;
		}

		const extension = path.extname(cleanPath);
		const fileName = extension.length === 0 ? `${cleanPath}.html` : cleanPath;
		const filePath = path.join(uiOutDir, fileName);
		if (!filePath.startsWith(uiOutDir) || !fs.existsSync(filePath)) {
			next();
			return;
		}

		res.sendFile(filePath);
	};
}

/**
 * Next App Router 静态导出会为 RSC 请求生成同名 txt，例如首页 index.txt。
 * 浏览器在 /ui?login=success 下会请求 /ui.txt，需要在鉴权路由前公开映射。
 * @param uiOutDir - UI 静态产物目录
 */
function createRootTextFallback(uiOutDir: string): (req: Request, res: Response, next: NextFunction) => void {
	return (req: Request, res: Response, next: NextFunction): void => {
		if (req.method !== "GET" && req.method !== "HEAD") {
			next();
			return;
		}

		const cleanPath = req.path.replace(/^\/+|\/+$/g, "");
		if (!cleanPath.endsWith(".txt") || cleanPath.includes("/") || cleanPath.includes("..")) {
			next();
			return;
		}

		const baseName = cleanPath.slice(0, -".txt".length);
		const fileName = baseName === "ui" ? "index.txt" : `${baseName}.txt`;
		const filePath = path.join(uiOutDir, fileName);
		if (!filePath.startsWith(uiOutDir) || !fs.existsSync(filePath)) {
			next();
			return;
		}

		res.sendFile(filePath);
	};
}

/**
 * 注册 WebUI 静态资源路由
 *
 * - 不存在产物时记录 warning，不抛出错误，保证 API 服务仍可启动
 * - 必须在鉴权 API 路由注册前调用，以避免被 API 路由抢先匹配
 * @param app - Express 应用实例
 */
export function registerStaticUiRoutes(app: Express): void {
	const uiOutDir = resolveUiOutDir();
	const ready = validateUiOutDir(uiOutDir);

	if (!ready) {
		logger.warn(`WebUI 静态产物不可用：${uiOutDir}（缺少 index.html 或 _next）。仅 API 路由可用。`);
		return;
	}

	// Next.js 静态资源（chunk、图片、字体等）
	app.use(
		"/_next",
		express.static(path.join(uiOutDir, "_next"), {
			fallthrough: true,
			immutable: true,
			maxAge: "1y",
		}),
	);

	// 资产前缀路径（向后兼容）
	app.use(
		`${ASSET_PREFIX}/_next`,
		express.static(path.join(uiOutDir, "_next"), {
			fallthrough: true,
			immutable: true,
			maxAge: "1y",
		}),
	);

	// favicon 与 WebUI HTML 路由均为公开资源，必须在鉴权路由之前命中。
	const faviconPath = path.join(uiOutDir, "favicon.ico");
	if (fs.existsSync(faviconPath)) {
		const sendFavicon = (_req: Request, res: Response): void => {
			res.sendFile(faviconPath);
		};
		app.get("/favicon.ico", sendFavicon);
		app.get("/ui/favicon.ico", sendFavicon);
		app.get("/ui/*/favicon.ico", sendFavicon);
	}

	app.use(createRootTextFallback(uiOutDir));

	// WebUI 入口
	app.use(
		"/ui",
		express.static(uiOutDir, {
			fallthrough: true,
			index: "index.html",
		}),
	);
	app.use("/ui", createUiHtmlFallback(uiOutDir));

	logger.info(`WebUI 静态路由已注册：${uiOutDir}（/_next, ${ASSET_PREFIX}/_next, /ui）`);
}
