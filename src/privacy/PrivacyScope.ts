import { isSubscriptionProvider, withoutProvider } from "../subscriptions/SubscriptionProviders";
/**
 * 脱敏生效范围。
 *
 * 只对「最终选中的 deployment」判定：提供方与模型各有一份包含列表，空列表表示不限。
 * 判定发生在 fallback、重试等路由逻辑之后、真正发请求之前，因此同一请求落到不同
 * 提供方时，按实际去向决定这一次是否脱敏。
 *
 * 匹配是大小写不敏感的「包含」匹配：配置项 `opencode` 能命中
 * `opencode-go/deepseek-v4.1-flash` 与 `cliproxy/opencode-go/deepseek-v4.1-flash`；
 * 列表项里写 `*` 只作为占位符，匹配前会被去掉。
 */
import type { Deployment } from "../types/router";
import type { PrivacyMaskingSettings } from "./PrivacyConfig";

/** 单条范围配置最大长度 */
export const PRIVACY_SCOPE_ENTRY_MAX_LENGTH = 64;

/** 单个范围列表最大条数 */
export const PRIVACY_SCOPE_ENTRY_MAX_COUNT = 50;

/** 范围判定目标：最终 deployment 的提供方与模型标识 */
export interface PrivacyScopeTarget {
	/** deployment 的提供方标识（custom_llm_provider） */
	readonly provider: string;
	/** 模型组名（客户端请求使用的模型名） */
	readonly modelName: string;
	/** 上游模型串（litellm_params.model） */
	readonly upstreamModel: string;
}

/**
 * 归一化范围配置项：去掉通配符和空白并转小写。
 * @param entry - 范围配置项
 */
function normalizeEntry(entry: string): string {
	return entry.replace(/\*/g, "").trim().toLowerCase();
}

/**
 * 取上游模型串里的插件/子提供方段（`cliproxy/opencode-go/x` → `opencode-go`）。
 * @param upstreamModel - 上游模型串
 */
function subProviderSegment(upstreamModel: string): string {
	const segments = upstreamModel.split("/");
	return segments.length >= 2 ? (segments[1] ?? "") : "";
}

/**
 * 把 deployment 归一化为范围判定目标。
 * @param deployment - 最终选中的 deployment
 */
export function privacyScopeTargetOf(deployment: Deployment): PrivacyScopeTarget {
	const params = deployment.litellm_params;
	return {
		provider: typeof params.custom_llm_provider === "string" ? params.custom_llm_provider : "",
		modelName: deployment.model_name,
		upstreamModel: typeof params.model === "string" ? params.model : "",
	};
}

/**
 * 判断某个列表是否命中。
 *
 * 列表为空表示不限；否则任意一条非空配置项被任意一个候选标识包含即算命中。
 * @param entries - 配置列表
 * @param identities - 部署侧候选标识
 */
function matchesIdentities(entries: readonly string[], identities: readonly string[]): boolean {
	const normalized = entries.map(normalizeEntry).filter((entry) => entry.length > 0);
	if (normalized.length === 0) {
		return true;
	}
	const lowered = identities.map((identity) => identity.trim().toLowerCase()).filter((identity) => identity.length > 0);
	return normalized.some((entry) => lowered.some((identity) => identity.includes(entry)));
}

/**
 * 判断最终 deployment 是否落在脱敏生效范围内。
 *
 * 提供方列表比对 provider 标识与上游模型里的插件段（例如 `opencode-go`），
 * 模型列表比对模型组名与上游模型串；两个列表都非空时取交集。
 * @param settings - 当前脱敏配置
 * @param target - 范围判定目标
 */
export function isPrivacyScopeMatch(settings: PrivacyMaskingSettings, target: PrivacyScopeTarget): boolean {
	const providerIdentities = [target.provider];
	if (!isSubscriptionProvider(target.provider) || target.upstreamModel.startsWith("cliproxy/")) {
		providerIdentities.push(subProviderSegment(target.upstreamModel));
	}
	const modelIdentities = [target.modelName, target.upstreamModel];
	if (isSubscriptionProvider(target.provider)) {
		providerIdentities.push("cliproxy");
		const raw = withoutProvider(target.upstreamModel, target.provider);
		const scoped = target.provider + "/" + raw;
		modelIdentities.push(scoped, "cliproxy/" + (target.provider === "commandcode" || target.provider === "opencode-go" ? scoped : raw));
	}
	return matchesIdentities(settings.providers, providerIdentities) && matchesIdentities(settings.models, modelIdentities);
}
