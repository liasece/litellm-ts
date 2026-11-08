import type { PlaygroundUsage } from "./PlaygroundModels";
export interface PlaygroundResponseUsage extends PlaygroundUsage {
	prompt_tokens?: number;
	completion_tokens?: number;
	total_tokens?: number;
	reasoning_tokens?: number;
}
