import { resolveProviderLogo } from "./ProviderIdentityLogic";

export interface ProviderBrand {
	/** Canonical provider key after alias normalization. */
	key: string;
	/** Short display name shown next to the brand image. */
	label: string;
	/** Official brand image URL, or an empty string when no dedicated asset exists. */
	logo: string;
	/** Tag color used by provider identity surfaces. */
	color: string;
}

const LOGO_FOLDER = "/ui/assets/logos/";

const PROVIDERS: Record<string, { label: string; logo: string; color: string }> = {
	codex: { label: "Codex", logo: "codex.svg", color: "blue" },
	claude: { label: "Claude", logo: "claude.svg", color: "orange" },
	antigravity: { label: "Antigravity", logo: "antigravity.svg", color: "cyan" },
	kimi: { label: "Kimi", logo: "kimi.svg", color: "purple" },
	xai: { label: "xAI", logo: "grok.svg", color: "default" },
	commandcode: { label: "CommandCode", logo: "commandcode.png", color: "geekblue" },
	opencode: { label: "OpenCode", logo: "opencode.png", color: "green" },
	gemini: { label: "Gemini", logo: "gemini.svg", color: "blue" },
	qwen: { label: "Qwen", logo: "qwen.png", color: "purple" },
	iflow: { label: "iFlow", logo: "iflow.svg", color: "cyan" },
	vertex: { label: "Vertex AI", logo: "vertex.svg", color: "blue" },
	meta: { label: "Meta", logo: "meta.svg", color: "blue" },
	devin: { label: "Devin", logo: "devin.svg", color: "default" },
	deepseek: { label: "DeepSeek", logo: "deepseek.svg", color: "cyan" },
	minimax: { label: "MiniMax", logo: "minimax.svg", color: "geekblue" },
};

const ALIASES: Record<string, string> = {
	"codex-device": "codex",
	anthropic: "claude",
	"anti-gravity": "antigravity",
	grok: "xai",
	"x-ai": "xai",
	"x.ai": "xai",
	"kimi-ai": "kimi",
	moonshot: "kimi",
	aistudio: "gemini",
	"gemini-cli": "gemini",
	"opencode-go": "opencode",
	muse: "meta",
};

export function normalizeProviderKey(provider: string): string {
	return provider.trim().toLowerCase().replace(/_/g, "-");
}

/**
 * Resolve the account provider reported by CLIProxy to its official brand.
 *
 * Auth file types are not fully normalized upstream: OAuth login ids, auth
 * file types and plugin providers use different spellings for the same
 * service. Unknown types keep the raw label and fall back to the initial
 * badge, so a new provider never breaks the account table.
 */
export function getProviderBrand(provider: string): ProviderBrand {
	const raw = provider.trim();
	const key = normalizeProviderKey(raw);
	const canonical = ALIASES[key] ?? key;
	const definition = PROVIDERS[canonical];
	if (!definition) {
		return { key: canonical, label: raw || "unknown", logo: "", color: "default" };
	}
	return {
		key: canonical,
		label: definition.label,
		logo: resolveProviderLogo(LOGO_FOLDER + definition.logo),
		color: definition.color,
	};
}
