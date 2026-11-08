import { z } from "zod";
import { dashboardFetch, getApiBaseUrl } from "../../platform/api/HttpApiClient";
import type { SessionGroupRef } from "../support/LogsModels";
import type { MessagePart } from "../support/PrettyMessagesModels";
import type { SessionTimelineResponse, SessionTimelineUpdate } from "../support/SessionTimelineModels";
const partSchema: z.ZodType<MessagePart> = z.lazy(() =>
	z.object({
		kind: z.enum([
			"text",
			"thinking",
			"redacted_thinking",
			"tool_call",
			"tool_result",
			"web_search",
			"file_search",
			"computer",
			"code",
			"code_result",
			"image",
			"document",
			"audio",
			"refusal",
			"unknown",
		]),
		label: z.string(),
		sourceType: z.string().optional(),
		id: z.string().optional(),
		name: z.string().optional(),
		text: z.string().optional(),
		data: z.unknown().optional(),
		status: z.string().optional(),
		isError: z.boolean().optional(),
		parts: z.array(partSchema).optional(),
	}),
);
const eventSchema = z.object({
	id: z.string(),
	request_id: z.string(),
	role: z.enum(["system", "user", "assistant", "tool", "request", "error"]),
	label: z.string(),
	timestamp: z.string(),
	model: z.string(),
	content: z.string(),
	image_sources: z.record(z.string(), z.string()).optional(),
	parts: z.array(partSchema).optional(),
	status: z.string().optional(),
	internal_call: z.boolean().optional(),
	builtin_capability: z.string().optional(),
	parent_request_id: z.string().optional(),
});
const activeSchema = z.object({ request_id: z.string(), events: z.array(eventSchema) });
const summarySchema = z.object({
	keys: z.array(z.object({ alias: z.string().nullable(), hash: z.string() })),
	request_count: z.number(),
	event_count: z.number(),
	total_spend: z.number(),
	total_tokens: z.number(),
	duration_seconds: z.number(),
	start_time: z.string().nullable(),
	end_time: z.string().nullable(),
	filtered_request_count: z.number().optional(),
	in_progress_request_count: z.number().optional(),
});
const windowSchema = z.object({
	returned_requests: z.number(),
	total_requests: z.number(),
	has_more: z.boolean(),
	before: z.string().nullable(),
	limit: z.number().nullable(),
});
const responseSchema = z.object({
	data: z.array(eventSchema),
	summary: summarySchema,
	active_requests: z.array(activeSchema).optional(),
	window: windowSchema.optional(),
});
const updateSchema = z.object({
	upsert: z.array(eventSchema),
	order: z.array(z.string()).optional(),
	removed: z.array(z.string()).optional(),
	summary: summarySchema,
	active_requests: z.array(activeSchema),
});
export const parseSessionTimeline = (value: unknown): SessionTimelineResponse => responseSchema.parse(value);
export const parseSessionTimelineUpdate = (value: unknown): SessionTimelineUpdate => updateSchema.parse(value);
export interface TimelineSocketCallbacks {
	open(): void;
	frame(frame: Record<string, unknown>): void;
	close(): void;
}
export type TimelineSocketFactory = (group: SessionGroupRef, teamId: string | undefined, callbacks: TimelineSocketCallbacks) => () => void;
export interface SessionTimelineApi {
	fetch(
		group: SessionGroupRef,
		teamId?: string,
		options?: { before?: string | null; signal?: AbortSignal },
	): Promise<SessionTimelineResponse>;
}
export const sessionTimelineApi: SessionTimelineApi = {
	async fetch(group, teamId, options = {}) {
		const params = new URLSearchParams({ session_group_type: group.type, session_group_id: group.id });
		if (teamId) params.set("team_id", teamId);
		if (options.before) params.set("before", options.before);
		const response = await dashboardFetch(getApiBaseUrl() + "/spend/logs/session/timeline?" + params.toString().replace(/\+/g, "%20"), {
			signal: options.signal,
		});
		if (!response.ok) {
			const body = await response.text();
			let message = "Session timeline request failed with HTTP " + response.status;
			if (body && !/^\s*(?:<!doctype\s+html|<html)\b/i.test(body)) {
				try {
					const parsed: unknown = JSON.parse(body);
					if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
						const record = parsed as Record<string, unknown>;
						const detail = record.detail ?? record.error ?? record.message;
						message = typeof detail === "string" ? detail : JSON.stringify(detail ?? parsed);
					} else message = body;
				} catch {
					message = body;
				}
			}
			throw new Error(message);
		}
		return parseSessionTimeline(await response.json());
	},
};
export const openSessionTimelineSocket: TimelineSocketFactory = (group, teamId, callbacks) => {
	const url = new URL(getApiBaseUrl() + "/spend/logs/session/timeline/stream", window.location.origin);
	url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
	url.searchParams.set("session_group_type", group.type);
	url.searchParams.set("session_group_id", group.id);
	if (teamId) url.searchParams.set("team_id", teamId);
	const socket = new WebSocket(url, ["litellm-log-stream"]);
	socket.onopen = callbacks.open;
	socket.onmessage = (event) => {
		try {
			const frame: unknown = JSON.parse(String(event.data));
			if (frame && typeof frame === "object" && !Array.isArray(frame)) callbacks.frame(frame as Record<string, unknown>);
		} catch {
			/* Ignore malformed frames; the next snapshot restores the subscription. */
		}
	};
	socket.onclose = callbacks.close;
	socket.onerror = () => {};
	return () => {
		socket.onopen = null;
		socket.onmessage = null;
		socket.onclose = null;
		socket.onerror = null;
		if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close(1000, "client closed");
	};
};
