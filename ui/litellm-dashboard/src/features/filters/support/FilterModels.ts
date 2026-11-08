import type { Component } from "vue";

export interface FilterChoice {
	label: string;
	value: string;
}
export interface FilterOption {
	name: string;
	label?: string;
	isSearchable?: boolean;
	searchFn?: (term: string) => Promise<FilterChoice[]>;
	search?: (term: string) => Promise<FilterChoice[]>;
	options?: FilterChoice[];
	component?: Component;
}
export type FilterValues = Record<string, string>;
