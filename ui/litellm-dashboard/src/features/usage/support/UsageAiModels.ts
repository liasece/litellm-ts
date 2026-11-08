export interface UsageAiToolStep {
	tool_name: string;
	tool_label: string;
	arguments: Record<string, string>;
	status: "running" | "complete" | "error";
	error?: string;
}
export interface UsageAiMessage {
	role: "user" | "assistant";
	content: string;
	toolCalls?: UsageAiToolStep[];
}
export type UsageAiEvent =
	| { type: "chunk"; content: string }
	| { type: "status"; message: string }
	| ({ type: "tool_call" } & UsageAiToolStep)
	| { type: "done" }
	| { type: "error"; message: string };
export interface UsageAiApi {
	models(signal?: AbortSignal): Promise<string[]>;
	stream(messages: Pick<UsageAiMessage, "role" | "content">[], model: string, signal: AbortSignal): AsyncIterable<UsageAiEvent>;
}
