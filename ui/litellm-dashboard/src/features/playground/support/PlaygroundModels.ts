export const EndpointType = {
	CHAT: "chat",
	RESPONSES: "responses",
	ANTHROPIC_MESSAGES: "anthropic_messages",
	IMAGE: "image",
	EMBEDDINGS: "embeddings",
	SPEECH: "speech",
	TRANSCRIPTION: "transcription",
	REALTIME: "realtime",
	VIDEO: "video",
} as const;
import type { PlaygroundAuth } from "../../platform/api/HttpApiClient";
export type { PlaygroundAuth };
export type EndpointType =
	| "chat"
	| "responses"
	| "anthropic_messages"
	| "image"
	| "embeddings"
	| "speech"
	| "transcription"
	| "realtime"
	| "video";
export interface PlaygroundModel {
	model_group: string;
	mode?: string;
	type?: "model" | "alias";
}
export interface PlaygroundUsage {
	completionTokens?: number;
	promptTokens?: number;
	totalTokens?: number;
	reasoningTokens?: number;
	cost?: number;
}
export interface PlaygroundMessage {
	id: string;
	role: string;
	content: string | Record<string, unknown>[];
	model?: string;
	isImage?: boolean;
	isAudio?: boolean;
	isEmbeddings?: boolean;
	reasoningContent?: string;
	timeToFirstToken?: number;
	totalLatency?: number;
	usage?: PlaygroundUsage;
	imagePreviewUrl?: string;
	image?: { url: string; detail: string };
	searchResults?: Record<string, unknown>[];
}
export interface CodeInterpreterResult {
	code: string;
	containerId: string;
}
export interface PlaygroundRequest {
	endpoint: EndpointType;
	auth: PlaygroundAuth;
	model: string;
	messages: { role: string; content: unknown }[];
	input: string;
	customBaseUrl?: string;
	tags: string[];
	traceId: string;
	temperature?: number;
	maxTokens?: number;
	mockFallbacks?: boolean;
	previousResponseId?: string | null;
	codeInterpreter?: boolean;
	voice: string;
	audio: File | null;
	signal?: AbortSignal;
}
export interface PlaygroundCallbacks {
	text(text: string, model?: string, role?: string): void;
	reasoning?(text: string): void;
	timing?(milliseconds: number): void;
	latency?(milliseconds: number): void;
	usage?(usage: PlaygroundUsage): void;
	image?(url: string, model?: string): void;
	audio?(url: string, model?: string): void;
	embeddings?(value: string, model?: string): void;
	search?(results: Record<string, unknown>[]): void;
	responseId?(id: string): void;
	code?(result: CodeInterpreterResult): void;
}
