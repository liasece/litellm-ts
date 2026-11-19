/**
 * 订阅配置与托管账号投影。
 *
 * 管理面的配置仍保存在 LiteLLM_Config 的 `cliproxy_settings` 参数里，保持与旧版本
 * 同一存储位置；这里只保留账号投影所需的最小 YAML 读写，不再生成 CPA 运行配置。
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import yaml from "js-yaml";
import { ApiError } from "../../core/api/ApiError";
import type { SubscriptionAccountKeys } from "../SubscriptionAccountKeys";
import type { SubscriptionAccountStore } from "./accountStore";

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
export function setManagedCommandCodeAccounts(userConfig: Record<string, unknown>, entries: Record<string, unknown>[]): void {
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
 * 把 CommandCode 托管账户投影为账号行。
 *
 * 配置是托管账号的唯一事实源：新增或改 key 就写入正文；从配置里删掉的账号进回收站，
 * 而不是删行——回收站保留正文才能人工恢复。已存在且完全一致的账号跳过写入，避免每次
 * 保存设置都重写 token。
 * @param accounts - 账号仓库
 * @param managed - 托管账户
 */
export async function projectCommandCodeAccounts(
	accounts: SubscriptionAccountStore,
	managed: readonly ManagedCommandCodeAccount[],
): Promise<void> {
	const desired = new Map<string, ManagedCommandCodeAccount>();
	for (const account of managed) {
		desired.set(commandCodeAccountFilename(account.apiKey), account);
	}
	const existing = (await accounts.list("commandcode", true)).filter(
		(account) => account.source === "commandcode" && account.key.startsWith("commandcode-managed-"),
	);
	for (const account of existing) {
		if (!desired.has(account.key) && account.trashedAt === undefined) {
			// 打标后再回收：只有「从配置里移除」的账号会在重新加入配置时自动恢复，
			// 管理面手工回收的账号必须由人显式恢复。
			await accounts.patchRaw(account.id, { managed_removed: true });
			await accounts.archive(account.id);
		}
	}
	for (const [key, account] of desired) {
		const current = existing.find((candidate) => candidate.key === key && candidate.trashedAt === undefined);
		if (current && current.raw["api_key"] === account.apiKey && current.raw["label"] === account.label) {
			continue;
		}
		const payload = { ...(current?.raw ?? {}), type: "commandcode", api_key: account.apiKey, label: account.label };
		await accounts.writeRaw(key, payload);
		if (current === undefined) {
			const trashed = existing.find((candidate) => candidate.key === key);
			// 配置里重新加回同一个 key：恢复由配置移除时回收的账号行。
			if (trashed !== undefined && trashed.raw["managed_removed"] === true) {
				await accounts.restore(trashed.id);
			}
			if (trashed !== undefined) {
				await accounts.patchRaw(trashed.id, { managed_removed: null });
			}
		}
	}
}

/**
 * 把加密保存的 API key 记录投影为账号行。
 *
 * 已撤销的 key 在回收站里，投影只更新正文、不改变有效性，因此保存设置不会把撤销过的
 * key 复活（旧实现写文件时会把 .trash 里的同名账号重新生成一份有效副本）。
 * @param accounts - 账号仓库
 * @param keys - key 仓库
 */
export async function projectSavedKeyAccounts(accounts: SubscriptionAccountStore, keys: SubscriptionAccountKeys): Promise<void> {
	await keys.load();
	for (const record of keys.records) {
		const key = savedKeyAccountFilename(record.provider, record.id);
		const existing = (await accounts.list())?.find((account) => account.key === key);
		const previous = existing?.raw ?? {};
		if (previous["api_key"] === record.key && previous["label"] === record.label && previous["type"] === record.provider) {
			continue;
		}
		const next: Record<string, unknown> = { ...previous, type: record.provider, api_key: record.key, label: record.label };
		if (record.provider === "opencode-go") {
			next["id"] = `opencode-go-key-${createHash("sha256").update(record.key).digest("hex")}`;
		}
		await accounts.writeRaw(key, next);
	}
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
