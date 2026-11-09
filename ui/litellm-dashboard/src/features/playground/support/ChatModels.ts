import { z } from "zod";
export interface ChatMessage {
	id: string;
	role: "user" | "assistant" | "tool";
	content: string;
	reasoningContent?: string;
	timestamp: number;
}
export interface ChatConversation {
	id: string;
	title: string;
	model: string;
	messages: ChatMessage[];
	createdAt: number;
	updatedAt: number;
}
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
			timestamp: z.number(),
		}),
	),
	createdAt: z.number(),
	updatedAt: z.number(),
});
export interface ChatComparisonExchange {
	userMessage: string;
	responses: Record<string, string>;
}
