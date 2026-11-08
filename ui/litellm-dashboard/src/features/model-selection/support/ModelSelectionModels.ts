export interface ModelGroupChoice extends Record<string, unknown> {
	model_group: string;
	mode?: string;
	providers?: string[];
}
