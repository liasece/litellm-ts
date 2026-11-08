import type { PlaygroundHistoryStore } from "../stores/PlaygroundHistoryStore";
export interface ComparisonSettings {
	tags: string[];
	vectorStores: string[];
	guardrails: string[];
	temperature: number;
	maxTokens: number;
	useAdvancedParams: boolean;
}
export interface ComparisonInstance extends ComparisonSettings {
	id: string;
	model: string;
	agent: string;
	history: PlaygroundHistoryStore;
	loading: boolean;
	applyAcrossModels: boolean;
	traceId?: string;
}
export type ComparisonEndpoint = "/v1/chat/completions" | "/a2a";
