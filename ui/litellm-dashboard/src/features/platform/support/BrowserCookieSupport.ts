export function readCookie(name: string): string | null {
	if (typeof document === "undefined") return null;
	const part = document.cookie
		.split(";")
		.map((item) => item.trim())
		.find((item) => item.startsWith(name + "="));
	if (!part) return null;
	const value = part.slice(name.length + 1);
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

export function writeCookie(name: string, value: string, maxAge = 300): void {
	if (typeof document === "undefined") return;
	const secure = typeof window !== "undefined" && window.location.protocol === "https:" ? "; Secure" : "";
	document.cookie = name + "=" + encodeURIComponent(value) + "; path=/; max-age=" + maxAge + "; SameSite=Lax" + secure;
}

export function deleteCookie(name: string): void {
	if (typeof document !== "undefined") document.cookie = name + "=; path=/; max-age=0";
}
