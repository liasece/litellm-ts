/** 读取非 HttpOnly cookie（仅用于 double-submit CSRF 等公开值）。 */
export function getCookie(name: string): string | null {
	if (typeof document === "undefined") return null;
	const cookieValue = document.cookie.split("; ").find((row) => row.startsWith(`${name}=`));
	if (!cookieValue) return null;
	const rawValue = cookieValue.slice(name.length + 1);
	try {
		return decodeURIComponent(rawValue);
	} catch {
		return null;
	}
}
