export const EndpointType = {
	CHAT: "chat",
	RESPONSES: "responses",
	ANTHROPIC_MESSAGES: "anthropic_messages",
	IMAGE: "image",
	IMAGE_EDITS: "image_edits",
	EMBEDDINGS: "embeddings",
	SPEECH: "speech",
	TRANSCRIPTION: "transcription",
	A2A_AGENTS: "a2a_agents",
	MCP: "mcp",
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
	| "image_edits"
	| "embeddings"
	| "speech"
	| "transcription"
	| "a2a_agents"
	| "mcp"
	| "realtime"
	| "video";
export interface PlaygroundModel {
	model_group: string;
	mode?: string;
	type?: "model" | "alias";
}
export interface PlaygroundAgent {
	agent_id: string;
	agent_name: string;
	description?: string;
	agent_card_params?: Record<string, unknown>;
}
export interface PlaygroundMcpServer {
	server_id: string;
	server_name?: string | null;
	alias?: string | null;
	[field: string]: unknown;
}
export interface PlaygroundMcpTool {
	name: string;
	description?: string;
	input_schema?: Record<string, unknown>;
	[field: string]: unknown;
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
	toolName?: string;
	imagePreviewUrl?: string;
	image?: { url: string; detail: string };
	searchResults?: Record<string, unknown>[];
	a2aMetadata?: Record<string, unknown>;
}
export interface CodeInterpreterAnnotation {
	type: "container_file_citation";
	container_id: string;
	file_id: string;
	filename: string;
	start_index: number;
	end_index: number;
}
export interface CodeInterpreterResult {
	code: string;
	containerId: string;
	annotations: CodeInterpreterAnnotation[];
}
export interface PlaygroundEvent {
	type: string;
	timestamp: number;
	item_id?: string;
	item?: Record<string, unknown>;
	delta?: unknown;
	[field: string]: unknown;
}
export interface PlaygroundRequest {
	endpoint: EndpointType;
	auth: PlaygroundAuth;
	model: string;
	messages: { role: string; content: unknown }[];
	input: string;
	customBaseUrl?: string;
	tags: string[];
	guardrails: string[];
	policies: string[];
	vectorStores: string[];
	mcpServers: PlaygroundMcpServer[];
	selectedMcpServers: string[];
	mcpRestrictions: Record<string, string[]>;
	traceId: string;
	temperature?: number;
	maxTokens?: number;
	mockFallbacks?: boolean;
	previousResponseId?: string | null;
	codeInterpreter?: boolean;
	voice: string;
	images: File[];
	audio: File | null;
	agent: string;
	signal?: AbortSignal;
}
export interface PlaygroundCallbacks {
	text(text: string, model?: string, role?: string): void;
	reasoning?(text: string): void;
	timing?(milliseconds: number): void;
	latency?(milliseconds: number): void;
	usage?(usage: PlaygroundUsage, toolName?: string): void;
	image?(url: string, model?: string): void;
	audio?(url: string, model?: string): void;
	embeddings?(value: string, model?: string): void;
	search?(results: Record<string, unknown>[]): void;
	mcp?(event: PlaygroundEvent): void;
	responseId?(id: string): void;
	code?(result: CodeInterpreterResult): void;
	a2a?(metadata: Record<string, unknown>): void;
}
