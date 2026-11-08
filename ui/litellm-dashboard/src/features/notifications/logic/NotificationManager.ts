import { isVNode } from "vue";
import { titleFor, classifyGeneralMessage } from "./NotificationClassificationLogic";
import { notificationStore } from "../stores/NotificationStore";
import {
	notificationPlacements,
	type NotificationConfig,
	type NotificationContent,
	type NotificationKind,
} from "../support/NotificationModels";
const defaults: Record<NotificationKind, { title: string; duration: number }> = {
	error: { title: "Error", duration: 6 },
	warning: { title: "Warning", duration: 5 },
	info: { title: "Info", duration: 4 },
	success: { title: "Success", duration: 3.5 },
};
function object(value: unknown): Record<string, unknown> {
	return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}
function normalize(
	input: NotificationContent | NotificationConfig,
	type: NotificationKind,
): NotificationConfig & { message: NotificationContent; duration: number } {
	const config = typeof input === "string" || isVNode(input) ? { description: input } : input;
	return { ...config, message: config.message ?? defaults[type].title, duration: config.duration ?? defaults[type].duration };
}
function send(type: NotificationKind, input: NotificationContent | NotificationConfig) {
	return notificationStore.push(type, normalize(input, type));
}
function numeric(value: unknown): number | undefined {
	return typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number.parseInt(value, 10) : undefined;
}
function status(input: unknown): number | undefined {
	const source = object(input);
	return numeric(object(source.response).status) ?? numeric(source.status_code) ?? numeric(source.code);
}
function parseError(value: unknown): string {
	if (!value) return "An unknown error occurred";
	if (typeof value === "string") return value;
	const source = object(value);
	if (source.message) {
		const message = String(source.message);
		try {
			const parsed: unknown = JSON.parse(message);
			const nested = object(object(parsed).error).message;
			return typeof nested === "string" ? nested : typeof parsed === "string" ? parsed : JSON.stringify(parsed, null, 2);
		} catch {
			return message;
		}
	}
	const data = object(source.response).data;
	if (data) {
		if (typeof data === "string") return data;
		const record = object(data);
		if (record.message) return String(record.message);
		if (record.error) {
			const err = record.error;
			return typeof err === "string" ? err : String(object(err).message || JSON.stringify(err));
		}
	}
	return String(value);
}
function description(input: unknown): string {
	if (typeof input === "string") return input;
	const source = object(input),
		response = object(object(source.response).data);
	return parseError(object(response.error).message ?? response.message ?? response.error ?? source.detail ?? source.message ?? input);
}
export const notificationManager = {
	error: (input: NotificationContent | NotificationConfig) => send("error", input),
	warning: (input: NotificationContent | NotificationConfig) => send("warning", input),
	info: (input: NotificationContent | NotificationConfig) => send("info", input),
	success: (input: NotificationContent | NotificationConfig) => send("success", input),
	fromBackend(input: unknown, extra: Omit<NotificationConfig, "message" | "description"> = {}) {
		const code = status(input),
			text = description(input),
			base = { ...extra, description: text };
		const source = object(input);
		if (code !== undefined || input instanceof Error || typeof input === "string" || "error" in source || "detail" in source) {
			const title = titleFor(code, text);
			if (
				["Rate Limit Exceeded", "Info", "Budget Exceeded", "Feature Unavailable", "Content Blocked", "Integration Error"].includes(
					title,
				)
			)
				return send("warning", { ...base, message: title, duration: extra.duration ?? 7 });
			if (title === "Server Error") return send("error", { ...base, message: title, duration: extra.duration ?? 8 });
			if (["Request Error", "Authentication Error", "Access Denied", "Not Found", "Error", "Already Exists"].includes(title))
				return send("error", { ...base, message: title, duration: extra.duration ?? 6 });
			return send("info", { ...base, message: title, duration: extra.duration ?? 4 });
		}
		const classified = classifyGeneralMessage(text);
		if (classified?.kind === "success") return send("success", { ...base, message: classified.title, duration: extra.duration ?? 3.5 });
		if (classified?.kind === "warning") return send("warning", { ...base, message: classified.title, duration: extra.duration ?? 6 });
		return send("info", { ...base, message: classified?.title ?? "Info", duration: extra.duration ?? 4 });
	},
	clear: () => notificationStore.clear(),
};
export function receiveNotificationEvent(event: Event): void {
	const value = object((event as CustomEvent<unknown>).detail);
	if (!["error", "warning", "info", "success"].includes(String(value.type))) return;
	const type = value.type as NotificationKind;
	const config: NotificationConfig = {};
	if (typeof value.duration === "number") config.duration = value.duration;
	if (typeof value.key === "string") config.key = value.key;
	if (notificationPlacements.includes(value.placement as NotificationConfig["placement"] & string))
		config.placement = value.placement as NotificationConfig["placement"];
	if (typeof value.description === "string" || isVNode(value.description)) {
		config.message = typeof value.message === "string" || isVNode(value.message) ? value.message : undefined;
		config.description = value.description;
	} else {
		config.message = typeof value.title === "string" ? value.title : undefined;
		config.description = typeof value.message === "string" || isVNode(value.message) ? value.message : "";
	}
	send(type, config);
}
export default notificationManager;
