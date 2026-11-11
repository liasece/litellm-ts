/**
 * 订阅配置与托管账号投影。
 *
 * 管理面的配置仍保存在 LiteLLM_Config 的 `cliproxy_settings` 参数里，保持与旧版本
 * 同一存储位置；这里只保留账号投影所需的最小 YAML 读写，不再生成 CPA 运行配置。
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { ApiError } from "../../core/api/ApiError";
import type { SubscriptionAccountKeys } from "../SubscriptionAccountKeys";

/** 配置参数名（保持旧值，回滚可读）。 */
export const SUBSCRIPTION_SETTINGS_PARAM = "cliproxy_settings";

/** 一个托管 CommandCode 账户。 */
export interface ManagedCommandCodeAccount {
	/** API key。 */
	readonly apiKey: string;
	/** 展示名。 */
	readonly label: string;
}

/**
 * 读取用户 YAML 片段。
 * @param source - YAML 文本
 * @throws {ApiError} YAML 不是对象时抛出
 */
export function parseUserConfig(source: string): Record<string, unknown> {
	const parsed = yaml.load(source);
	if (parsed === undefined || parsed === null) {
		return {};
	}
	if (!isRecord(parsed)) {
		throw ApiError.badRequest("订阅配置必须是 YAML 对象");
	}
	return parsed;
}

/**
 * 序列化用户 YAML 片段。
 * @param value - 配置对象
 * @throws {ApiError} 值不是对象或序列化结果非法时抛出
 */
export function serializeUserConfig(value: unknown): string {
	if (!isRecord(value)) {
		throw ApiError.badRequest("订阅配置必须是对象");
	}
	const source = yaml.dump(value, { noRefs: true, lineWidth: 120, sortKeys: false });
	parseUserConfig(source);
	return source;
}

/**
 * 读取 config.yaml 中由 LiteLLM 托管的 CommandCode 账户。
 * @param userConfig - 用户配置
 */
export function extractManagedCommandCodeAccounts(userConfig: Record<string, unknown>): ManagedCommandCodeAccount[] {
	const result: ManagedCommandCodeAccount[] = [];
	for (const entry of commandCodeAccountEntries(userConfig)) {
		const value = entry["api-key"];
		const apiKey = typeof value === "string" ? value.trim() : "";
		if (!apiKey) {
			continue;
		}
		const labelValue = entry["label"];
		const label = typeof labelValue === "string" && labelValue.trim() ? labelValue.trim() : "CommandCode";
		result.push({ apiKey: apiKey, label: label });
	}
	return result;
}

/**
 * 把 CommandCode 账户写回配置结构。
 * @param userConfig - 用户配置
 * @param entries - 账户条目
 */
export function setManagedCommandCodeAccounts(
	userConfig: Record<string, unknown>,
	entries: Record<string, unknown>[],
): void {
	const plugins = isRecord(userConfig["plugins"]) ? { ...userConfig["plugins"] } : {};
	const accounts = isRecord(plugins["managed-accounts"]) ? { ...plugins["managed-accounts"] } : {};
	if (entries.length > 0) {
		accounts["commandcode"] = entries;
	} else {
		delete accounts["commandcode"];
	}
	if (Object.keys(accounts).length > 0) {
		plugins["managed-accounts"] = accounts;
	} else {
		delete plugins["managed-accounts"];
	}
	if (Object.keys(plugins).length > 0) {
		userConfig["plugins"] = plugins;
	} else {
		delete userConfig["plugins"];
	}
}

/**
 * 托管 CommandCode 账户对应的 auth 文件名。
 * @param apiKey - API key
 */
export function commandCodeAccountFilename(apiKey: string): string {
	return `commandcode-managed-${createHash("sha256").update(apiKey.trim()).digest("hex").slice(0, 12)}.json`;
}

/**
 * 托管 OpenCode key 对应的 auth 文件名。
 * @param provider - 来源
 * @param id - 记录 ID
 */
export function savedKeyAccountFilename(provider: string, id: string): string {
	return `subscription-${provider}-${id}.json`;
}

/**
 * 从旧运行时的 config.yaml 导入仍需保留的托管账户配置。
 *
 * 旧管理面可能把 CommandCode 账户只写在生成配置中；升级后首次启动若数据库还没有
 * 设置，只迁移 `plugins`，不把端口、auth-dir 等运行时字段带入新设置。
 * @param authDir - auth 目录；config.yaml 位于其父目录
 * @returns YAML 文本；没有可迁移内容时为 undefined
 */
export async function importLegacyManagedConfig(authDir: string): Promise<string | undefined> {
	const configPath = path.resolve(authDir, "..", "config.yaml");
	let source: string;
	try {
		source = await readFile(configPath, "utf8");
	} catch {
		return undefined;
	}
	const parsed = yaml.load(source);
	if (!isRecord(parsed) || !isRecord(parsed["plugins"])) {
		return undefined;
	}
	const plugins = parsed["plugins"];
	if (!isRecord(plugins["managed-accounts"])) {
		return undefined;
	}
	return yaml.dump({ plugins: plugins }, { noRefs: true, lineWidth: 120, sortKeys: false });
}

/**
 * 把 CommandCode 托管账户投影为 auth 文件。
 * @param authDir - auth 目录
 * @param accounts - 托管账户
 */
export async function projectCommandCodeAccounts(
	authDir: string,
	accounts: readonly ManagedCommandCodeAccount[],
): Promise<void> {
	await mkdir(authDir, { recursive: true, mode: 0o700 });
	const desired = new Map<string, ManagedCommandCodeAccount>();
	for (const account of accounts) {
		desired.set(commandCodeAccountFilename(account.apiKey), account);
	}
	const existing = (await readdir(authDir).catch(() => [] as string[])).filter(
		(name) => name.startsWith("commandcode-managed-") && name.endsWith(".json"),
	);
	await Promise.all(
		existing.filter((name) => !desired.has(name)).map((name) => unlink(path.join(authDir, name)).catch(() => undefined)),
	);
	for (const [filename, account] of desired) {
		const target = path.join(authDir, filename);
		let current: Record<string, unknown> | null = null;
		try {
			const parsed: unknown = JSON.parse(await readFile(target, "utf8"));
			if (isRecord(parsed)) {
				current = parsed;
			}
		} catch {
			current = null;
		}
		if (current?.["type"] === "commandcode" && current["api_key"] === account.apiKey && current["label"] === account.label) {
			continue;
		}
		const payload = { ...(current ?? {}), type: "commandcode", api_key: account.apiKey, label: account.label };
		await atomicWrite(target, payload);
	}
}

/**
 * 把加密保存的 API key 记录投影为 auth 文件。
 * @param authDir - auth 目录
 * @param keys - key 仓库
 */
export async function projectSavedKeyAccounts(authDir: string, keys: SubscriptionAccountKeys): Promise<void> {
	await keys.load();
	await mkdir(authDir, { recursive: true, mode: 0o700 });
	for (const record of keys.records) {
		const filename = savedKeyAccountFilename(record.provider, record.id);
		const target = path.join(authDir, filename);
		let previous: Record<string, unknown> = {};
		try {
			const parsed: unknown = JSON.parse(await readFile(target, "utf8"));
			if (isRecord(parsed)) {
				previous = parsed;
			}
		} catch {
			previous = {};
		}
		if (
			previous["api_key"] === record.key &&
			previous["label"] === record.label &&
			previous["type"] === record.provider
		) {
			continue;
		}
		const next: Record<string, unknown> = { ...previous, type: record.provider, api_key: record.key, label: record.label };
		if (record.provider === "opencode-go") {
			next["id"] = `opencode-go-key-${createHash("sha256").update(record.key).digest("hex")}`;
		}
		await atomicWrite(target, next);
	}
}

/**
 * 原子写入 JSON。
 * @param target - 目标路径
 * @param payload - JSON 对象
 */
export async function atomicWrite(target: string, payload: Record<string, unknown>): Promise<void> {
	const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
	await writeFile(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
	await rename(temporary, target);
}

/**
 * 判断普通对象。
 * @param value - 待判定值
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 读取 CommandCode 原始条目。
 * @param userConfig - 用户配置
 */
function commandCodeAccountEntries(userConfig: Record<string, unknown>): Record<string, unknown>[] {
	const plugins = isRecord(userConfig["plugins"]) ? userConfig["plugins"] : null;
	const accounts = plugins && isRecord(plugins["managed-accounts"]) ? plugins["managed-accounts"] : null;
	const raw = accounts?.["commandcode"];
	if (Array.isArray(raw)) {
		return raw.filter(isRecord).map((entry) => ({ ...entry }));
	}
	if (isRecord(raw)) {
		return [{ ...raw }];
	}
	return [];
}
