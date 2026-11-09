import type { PlaygroundHistoryStore } from "../stores/PlaygroundHistoryStore";
export interface ComparisonSettings {
	tags: string[];
	temperature: number;
	maxTokens: number;
	useAdvancedParams: boolean;
}
export interface ComparisonInstance extends ComparisonSettings {
	id: string;
	model: string;
	history: PlaygroundHistoryStore;
	loading: boolean;
	applyAcrossModels: boolean;
	traceId?: string;
}
