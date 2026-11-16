/**
 * 日志行的"这把 key 是谁"展示补充。
 *
 * 虚拟密钥在 `LiteLLM_VerificationToken` 里有一行，别名随鉴权上下文写进
 * `metadata.user_api_key_alias`，日志列表的 Key Name 列直接用它。
 * 主密钥不是虚拟密钥：鉴权上下文只有 api_key，落库时明文被替换成它的哈希
 * （见 SpendTracker 的 `_protectApiKeyForDb`），token 表里查无此行。
 * 结果是主密钥请求在列表里 Key Name 显示 "-"，整批流量在大盘上无法归属。
 *
 * 这里在响应组装阶段按哈希比对补一个可读标签：不改库、不改历史行，
 * 也不影响筛选（筛选仍走 `key_alias` 冗余列）。
 */

import { getConfig } from "../core/config";
import { hashApiKey } from "../core/utils/crypto";

/** 主密钥日志行的展示别名。 */
export const MASTER_KEY_SPEND_LOG_ALIAS = "Master Key";

/** undefined 表示尚未计算，null 表示当前进程没有配置主密钥。 */
let cachedMasterKeyHash: string | null | undefined;

/**
 * 当前进程主密钥的哈希；未配置时为 null。
 *
 * 与 SpendTracker 取主密钥的方式一致：优先配置（可能来自数据库热更新），
 * 配置尚未就绪时回退环境变量。结果按进程缓存，避免每行日志都读一次配置。
 */
export function getMasterKeyHash(): string | null {
	if (cachedMasterKeyHash !== undefined) {
		return cachedMasterKeyHash;
	}
	let masterKey: string | undefined;
	try {
		masterKey = getConfig().generalSettings.master_key;
	} catch {
		masterKey = undefined;
	}
	const plaintext = masterKey ?? process.env.LITELLM_MASTER_KEY;
	cachedMasterKeyHash = plaintext && plaintext.length > 0 ? hashApiKey(plaintext) : null;
	return cachedMasterKeyHash;
}

/**
 * 按给定主密钥哈希判断是否需要补别名（纯函数，便于用例覆盖各种 key 组合）。
 * @param apiKey - 日志行落库的 api_key（虚拟密钥与主密钥都是哈希）
 * @param metadata - 已解析的行 metadata
 * @param masterKeyHash - 主密钥哈希；null 表示当前进程没有主密钥
 * @returns 需要写回行的 metadata；无需补充时返回原值
 */
export function annotateSpendLogKeyAlias(
	apiKey: unknown,
	metadata: Record<string, unknown> | null,
	masterKeyHash: string | null,
): Record<string, unknown> | null {
	if (typeof apiKey !== "string" || apiKey.length === 0) {
		return metadata;
	}
	// 已有别名（虚拟密钥）时不动，避免覆盖真实归属。
	if (typeof metadata?.["user_api_key_alias"] === "string" && String(metadata["user_api_key_alias"]).length > 0) {
		return metadata;
	}
	if (masterKeyHash === null || apiKey !== masterKeyHash) {
		return metadata;
	}
	return { ...(metadata ?? {}), user_api_key_alias: MASTER_KEY_SPEND_LOG_ALIAS };
}

/**
 * 用当前进程的主密钥哈希补别名；其他行原样返回。
 * @param apiKey - 日志行落库的 api_key
 * @param metadata - 已解析的行 metadata
 */
export function annotateMasterKeyAlias(apiKey: unknown, metadata: Record<string, unknown> | null): Record<string, unknown> | null {
	return annotateSpendLogKeyAlias(apiKey, metadata, getMasterKeyHash());
}
