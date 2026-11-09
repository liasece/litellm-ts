/**
 * 采集网关自身配置的凭据，用于「精确匹配」脱敏。
 *
 * 场景：agent 把 `.env`、`config.yaml` 或部署快照整段贴进上下文时，里面往往含有
 * 网关正在使用的 provider key。这些值不一定符合任何密钥格式，正则识别不到，
 * 但它们恰恰最不该发给上游模型。
 *
 * 采集范围只包含部署的 `api_key` 与进程环境变量中名称像凭据的值；结果缓存 60 秒，
 * 不随每个请求遍历 deployments。
 */
import type { Router as LiteLLMRouter } from "../router/Router";

/** 凭据缓存有效期（毫秒） */
const CACHE_TTL_MS = 60_000;

/** 参与精确匹配的最小长度，过短的值容易误伤正文 */
const MIN_SECRET_LENGTH = 12;

/** 单个凭据的最大长度（长于此的视为证书/JSON blob，不做字面量匹配） */
const MAX_SECRET_LENGTH = 4_096;

/** 环境变量名中表示凭据的关键词 */
const ENV_SECRET_NAME_PATTERN = /(?:API_?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|ACCESS_?KEY)/i;

/** 缓存状态 */
let cachedSecrets: string[] = [];
let cachedAt = 0;

/**
 * 从环境变量收集凭据值。
 */
function collectEnvironmentSecrets(): string[] {
	const secrets: string[] = [];
	for (const [name, value] of Object.entries(process.env)) {
		if (typeof value !== "string" || !ENV_SECRET_NAME_PATTERN.test(name)) {
			continue;
		}
		if (value.length < MIN_SECRET_LENGTH || value.length > MAX_SECRET_LENGTH) {
			continue;
		}
		secrets.push(value);
	}
	return secrets;
}

/**
 * 从 Router deployments 收集 provider key。
 * @param router - 路由实例（可为空）
 */
function collectDeploymentSecrets(router: LiteLLMRouter | undefined): string[] {
	if (router === undefined || typeof router.getDeployments !== "function") {
		return [];
	}
	const secrets: string[] = [];
	try {
		for (const deployment of router.getDeployments()) {
			const apiKey = deployment.litellm_params?.api_key;
			if (typeof apiKey !== "string") {
				continue;
			}
			if (apiKey.length < MIN_SECRET_LENGTH || apiKey.length > MAX_SECRET_LENGTH) {
				continue;
			}
			secrets.push(apiKey);
		}
	} catch {
		return [];
	}
	return secrets;
}

/**
 * 读取网关自身配置的凭据集合（带 60 秒缓存）。
 * @param router - 路由实例
 */
export function getConfiguredSecrets(router: LiteLLMRouter | undefined): string[] {
	const now = Date.now();
	if (now - cachedAt < CACHE_TTL_MS && cachedAt > 0) {
		return cachedSecrets;
	}
	const merged = new Set<string>();
	for (const secret of collectDeploymentSecrets(router)) {
		merged.add(secret);
	}
	const configuredExtra = process.env["PRIVACY_EXTRA_SECRETS"];
	if (typeof configuredExtra === "string" && configuredExtra.length > 0) {
		for (const item of configuredExtra.split(",")) {
			const trimmed = item.trim();
			if (trimmed.length >= MIN_SECRET_LENGTH) {
				merged.add(trimmed);
			}
		}
	}
	for (const secret of collectEnvironmentSecrets()) {
		merged.add(secret);
	}
	cachedSecrets = [...merged];
	cachedAt = now;
	return cachedSecrets;
}

/**
 * 清空缓存（配置热更新或测试使用）。
 */
export function invalidateConfiguredSecrets(): void {
	cachedSecrets = [];
	cachedAt = 0;
}
