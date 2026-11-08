import { readCookie } from "./BrowserCookieSupport";

const WORKER_URL_KEY = "litellm_worker_url";
let configuredBaseUrl: string | null = null;
let serverRootPath = "/";
let workerBaseUrl: string | null | undefined;

function validatedHttpUrl(value: string | null): string | null {
	if (!value) return null;
	try {
		const url = new URL(value);
		return url.protocol === "https:" || url.protocol === "http:" ? value.replace(/\/$/, "") : null;
	} catch {
		return null;
	}
}

function readWorkerUrl(): string | null {
	if (workerBaseUrl !== undefined) return workerBaseUrl;
	let stored: string | null = null;
	try {
		stored = typeof window === "undefined" ? null : window.localStorage.getItem(WORKER_URL_KEY);
		const valid = validatedHttpUrl(stored);
		if (stored && !valid) window.localStorage.removeItem(WORKER_URL_KEY);
		workerBaseUrl = valid;
	} catch {
		workerBaseUrl = null;
	}
	return workerBaseUrl;
}

export function getApiBaseUrl(): string {
	return readWorkerUrl() ?? configuredBaseUrl ?? (typeof location === "undefined" ? "" : location.origin);
}

export function getServerRootPath(): string {
	return serverRootPath;
}

export function configureApiEnvironment(rootPath: string, baseUrl: string | null): void {
	serverRootPath = rootPath || "/";
	const fallback = typeof location === "undefined" ? "" : location.origin;
	const resolved = (baseUrl || fallback).replace(/\/$/, "");
	configuredBaseUrl =
		serverRootPath !== "/" && !resolved.endsWith(serverRootPath)
			? resolved + (serverRootPath.startsWith("/") ? serverRootPath : "/" + serverRootPath)
			: resolved;
}

export function switchToWorkerUrl(url: string | null): boolean {
	const valid = validatedHttpUrl(url);
	if (url && !valid) return false;
	workerBaseUrl = valid;
	try {
		if (valid) window.localStorage.setItem(WORKER_URL_KEY, valid);
		else window.localStorage.removeItem(WORKER_URL_KEY);
	} catch {
		// The current tab remains usable when storage is unavailable.
	}
	return true;
}

export function getCsrfToken(): string | null {
	return readCookie("litellm_csrf_token");
}
