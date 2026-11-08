import { z } from "zod";
import type { PlaygroundEvent } from "./PlaygroundModels";
export interface ChatMessage {
	id: string;
	role: "user" | "assistant" | "tool";
	content: string;
	reasoningContent?: string;
	mcpEvents?: PlaygroundEvent[];
	toolName?: string;
	toolArgs?: Record<string, unknown>;
	toolResult?: string;
	timestamp: number;
}
export interface ChatConversation {
	id: string;
	title: string;
	model: string;
	messages: ChatMessage[];
	mcpServerNames: string[];
	createdAt: number;
	updatedAt: number;
}
const event = z.object({ type: z.string(), timestamp: z.number(), item: z.record(z.string(), z.unknown()).optional() }).passthrough();
export const conversationSchema = z.object({
	id: z.string(),
	title: z.string(),
	model: z.string(),
	messages: z.array(
		z.object({
			id: z.string(),
			role: z.enum(["user", "assistant", "tool"]),
			content: z.string(),
			reasoningContent: z.string().optional(),
			mcpEvents: z.array(event).optional(),
			toolName: z.string().optional(),
			toolArgs: z.record(z.string(), z.unknown()).optional(),
			toolResult: z.string().optional(),
			timestamp: z.number(),
		}),
	),
	mcpServerNames: z.array(z.string()),
	createdAt: z.number(),
	updatedAt: z.number(),
});
export interface ChatComparisonExchange {
	userMessage: string;
	responses: Record<string, string>;
}
