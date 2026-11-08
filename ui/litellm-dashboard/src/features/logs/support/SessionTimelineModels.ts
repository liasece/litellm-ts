import type { MessagePart } from "./PrettyMessagesModels";
export interface SessionTimelineEvent {
	image_sources?: Record<string, string>;
	id: string;
	request_id: string;
	role: "system" | "user" | "assistant" | "tool" | "request" | "error";
	label: string;
	timestamp: string;
	model: string;
	content: string;
	parts?: MessagePart[];
	status?: string;
	internal_call?: boolean;
	builtin_capability?: string;
	parent_request_id?: string;
}
export interface SessionActiveTimelineRequest {
	request_id: string;
	events: SessionTimelineEvent[];
}
export interface SessionTimelineSummary {
	keys: { alias: string | null; hash: string }[];
	request_count: number;
	event_count: number;
	total_spend: number;
	total_tokens: number;
	duration_seconds: number;
	start_time: string | null;
	end_time: string | null;
	filtered_request_count?: number;
	in_progress_request_count?: number;
}
export interface SessionTimelineWindow {
	returned_requests: number;
	total_requests: number;
	has_more: boolean;
	before: string | null;
	limit: number | null;
}
export interface SessionTimelineResponse {
	data: SessionTimelineEvent[];
	summary: SessionTimelineSummary;
	active_requests?: SessionActiveTimelineRequest[];
	window?: SessionTimelineWindow;
}
export interface SessionTimelineUpdate {
	upsert: SessionTimelineEvent[];
	order?: string[];
	removed?: string[];
	summary: SessionTimelineSummary;
	active_requests: SessionActiveTimelineRequest[];
}
