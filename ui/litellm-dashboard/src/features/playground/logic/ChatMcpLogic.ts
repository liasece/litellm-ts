import type { PlaygroundMcpServer } from "../support/PlaygroundModels";
import { asRecord } from "./PlaygroundValueLogic";
export const chatMcpName = (server: PlaygroundMcpServer) => server.server_name ?? server.alias ?? server.server_id;
export function chatMcpLogo(server: PlaygroundMcpServer) {
	const logo = asRecord(server.mcp_info)?.logo_url;
	return typeof logo === "string" ? logo : undefined;
}
export function chatMcpTransport(server: PlaygroundMcpServer) {
	const transport = typeof server.transport === "string" ? server.transport : "sse";
	return server.spec_path && transport !== "stdio" ? "openapi" : transport;
}
const colors = ["#1677ff", "#52c41a", "#fa8c16", "#eb2f96", "#722ed1", "#13c2c2", "#fa541c", "#2f54eb", "#a0d911", "#faad14"];
export function chatMcpColor(name: string) {
	let hash = 0;
	for (let index = 0; index < name.length; index++) hash = name.charCodeAt(index) + ((hash << 5) - hash);
	return colors[Math.abs(hash) % colors.length];
}
export function credentialRelativeTime(iso: string | null | undefined, now = Date.now()) {
	if (!iso) return "";
	const seconds = Math.floor((now - new Date(iso).getTime()) / 1000);
	if (!Number.isFinite(seconds)) return "";
	if (seconds < 60) return "just now";
	const minutes = Math.floor(seconds / 60);
	if (minutes < 60) return minutes + "m ago";
	const hours = Math.floor(minutes / 60);
	return hours < 24 ? hours + "h ago" : Math.floor(hours / 24) + "d ago";
}
export function credentialExpiry(iso: string | null | undefined, now = Date.now()) {
	if (!iso) return "Does not expire";
	const diff = new Date(iso).getTime() - now;
	if (!Number.isFinite(diff)) return "";
	if (diff <= 0) return "Expired";
	const minutes = Math.floor(diff / 60000),
		hours = Math.floor(minutes / 60),
		days = Math.floor(hours / 24);
	return "Expires in " + (days > 0 ? days + "d" : hours > 0 ? hours + "h" : minutes + "m");
}
export function mcpCallbackUrl(location: Pick<Location, "origin" | "pathname">) {
	const index = location.pathname.indexOf("/ui"),
		prefix = index >= 0 ? location.pathname.slice(0, index + 3).replace(/\/+$/, "") : "";
	return location.origin + prefix + "/mcp/oauth/callback";
}
export function base64Url(bytes: Uint8Array) {
	let value = "";
	for (const byte of bytes) value += String.fromCharCode(byte);
	return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export async function pkceChallenge(verifier: string) {
	return base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
}
