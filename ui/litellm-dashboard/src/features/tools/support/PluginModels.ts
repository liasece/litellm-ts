export interface PluginSource {
	source: string;
	repo?: string;
	url?: string;
	path?: string;
}
export interface ClaudePlugin extends Record<string, unknown> {
	id: string;
	name: string;
	source: PluginSource;
	version?: string;
	description?: string;
	author?: { name?: string; email?: string };
	homepage?: string;
	keywords?: string[];
	category?: string;
	enabled: boolean;
	created_at?: string;
	updated_at?: string;
	created_by?: string;
}
export interface PluginDraft extends Record<string, unknown> {
	name: string;
	sourceType: "github" | "url" | "git-subdir";
	repo?: string;
	url?: string;
	path?: string;
	version?: string;
	description?: string;
	authorName?: string;
	authorEmail?: string;
	homepage?: string;
	category?: string;
	keywords?: string;
}
export const pluginCategories = [
	"Development",
	"Productivity",
	"Learning",
	"Security",
	"Data & Analytics",
	"Integration",
	"Testing",
	"Documentation",
];
