import { z } from "zod";
export interface PlaygroundStorage {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}
export function browserSessionStorage(): PlaygroundStorage | undefined {
	try {
		return typeof window === "undefined" ? undefined : window.sessionStorage;
	} catch {
		return undefined;
	}
}
export function readStored<T>(storage: PlaygroundStorage | undefined, key: string, schema: z.ZodType<T>, fallback: T): T {
	try {
		const value = storage?.getItem(key);
		if (value === null || value === undefined) return fallback;
		const parsed = schema.safeParse(JSON.parse(value) as unknown);
		return parsed.success ? parsed.data : fallback;
	} catch {
		return fallback;
	}
}
export function readText(storage: PlaygroundStorage | undefined, key: string, fallback = ""): string {
	try {
		return storage?.getItem(key) ?? fallback;
	} catch {
		return fallback;
	}
}
export function storeValue(storage: PlaygroundStorage | undefined, key: string, value: unknown) {
	try {
		if (value === undefined || value === null) storage?.removeItem(key);
		else storage?.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
	} catch {
		/* Browser storage can be unavailable or full. */
	}
}
export async function fileDataUrl(file: File): Promise<string> {
	const bytes = new Uint8Array(await file.arrayBuffer());
	let binary = "";
	for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
	const type = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : "image/jpeg");
	return "data:" + type + ";base64," + window.btoa(binary);
}
