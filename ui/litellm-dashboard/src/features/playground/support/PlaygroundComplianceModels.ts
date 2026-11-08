import { z } from "zod";
import type { PlaygroundAuth } from "./PlaygroundModels";
export interface CompliancePrompt {
	id: string;
	framework: string;
	category: string;
	categoryIcon: string;
	categoryDescription: string;
	prompt: string;
	expectedResult: "fail" | "pass";
}
export interface ComplianceCategory {
	name: string;
	icon: string;
	description: string;
	prompts: CompliancePrompt[];
}
export interface ComplianceFramework {
	name: string;
	icon: string;
	description: string;
	categories: ComplianceCategory[];
}
export interface ComplianceResult {
	promptId: string;
	prompt: string;
	category: string;
	categoryIcon: string;
	expectedResult: "fail" | "pass";
	actualResult: "blocked" | "allowed";
	isMatch: boolean;
	triggeredBy?: string;
	returnedText?: string;
	status: "pending" | "running" | "complete";
}
export interface ComplianceQuickMessage {
	id: string;
	type: "user" | "system";
	text: string;
	result?: "blocked" | "allowed";
	triggeredBy?: string;
	returnedText?: string;
}
export interface ComplianceOptions {
	backendMode?: "policies" | "chat_completions";
	fixedModel?: () => string | undefined;
	auth?: () => PlaygroundAuth;
	baseUrl?: () => string | undefined;
}
export type ComplianceFilter = "all" | "matches" | "mismatches" | "pending";

const compliancePromptSchema = z.object({
	id: z.string(),
	framework: z.string(),
	category: z.string(),
	categoryIcon: z.string(),
	categoryDescription: z.string(),
	prompt: z.string(),
	expectedResult: z.enum(["fail", "pass"]),
});
export const complianceFrameworkSchema = z.object({
	name: z.string(),
	icon: z.string(),
	description: z.string(),
	categories: z.array(
		z.object({ name: z.string(), icon: z.string(), description: z.string(), prompts: z.array(compliancePromptSchema) }),
	),
});
