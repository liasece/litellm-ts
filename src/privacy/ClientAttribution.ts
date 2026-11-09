/**
 * 从请求头与解析后的 deployment 推导「客户端」与「提供方」，用于统计页的分组。
 *
 * 客户端标签只用于展示与聚合，不参与任何控制流；识别不到的请求统一记为 `other`，
 * 不丢弃统计。提供方取 deployment 的 `custom_llm_provider`，解析不到时留空。
 */
import type { Router as LiteLLMRouter } from "../router/Router";

/** 已知客户端标识（与 Dashboard 的展示文案一一对应） */
export type PrivacyClient = "claude_code" | "codex" | "antigravity" | "pi" | "other";

/**
 * 读取单个请求头（兼容数组形式）。
 * @param value - 请求头值
 */
function headerText(value: string | string[] | undefined): string {
	if (Array.isArray(value)) {
		return value[0] ?? "";
	}
	return value ?? "";
}

/**
 * 识别客户端。
 * @param headers - Express 请求头
 */
export function detectPrivacyClient(headers: Record<string, string | string[] | undefined>): PrivacyClient {
	const userAgent = headerText(headers["user-agent"]);
	const app = headerText(headers["x-app"]).toLowerCase();
	const combined = `${app} ${userAgent}`.toLowerCase();
	if (combined.includes("claude-cli/") || combined.includes("claude-code")) {
		return "claude_code";
	}
	if (combined.includes("codex")) {
		return "codex";
	}
	if (combined.includes("antigravity")) {
		return "antigravity";
	}
	if (/(^|\s)pi[/\s-]/.test(combined) || combined.includes("pi-cli")) {
		return "pi";
	}
	return "other";
}

/**
 * 解析请求对应的上游提供方。
 * @param router - 路由实例
 * @param model - 请求里的模型名
 */
export function detectPrivacyProvider(router: LiteLLMRouter | undefined, model: unknown): string {
	if (typeof model !== "string" || model.length === 0) {
		return "";
	}
	if (router === undefined || typeof router.getAvailableDeployment !== "function") {
		return "";
	}
	try {
		const resolved = router.getAvailableDeployment(model);
		const provider = resolved?.deployment?.litellm_params?.custom_llm_provider;
		return typeof provider === "string" ? provider : "";
	} catch {
		return "";
	}
}
