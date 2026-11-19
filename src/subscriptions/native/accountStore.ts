/**
 * 订阅账号仓库。
 *
 * 账号正文存数据库（`LiteLLM_SubscriptionAccount.payload`），有效性由 `trashed_at`
 * 决定：为空参与调度，非空即回收站。文件只在升级时读一次——启动时把旧 auth 目录与
 * 目录内 `.trash/` 里还没入库的账号导进来，之后运行期不再碰文件，因此不再有「回收站
 * 文件名加时间戳再解析」「同名文件恢复互相覆盖」这类目录语义。
 *
 * 仓库只负责读写与元数据归一化；调度、刷新与协议执行由其他模块负责。
 */

import { createHash } from "node:crypto";
import type { Dirent } from "node:fs";
import { readFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import { ApiError } from "../../core/api/ApiError";
import {
	MemorySubscriptionAccountPersistence,
	type StoredSubscriptionAccount,
	type SubscriptionAccountPersistence,
} from "./accountPersistence";
import { isSubscriptionSource, type SubscriptionAccount, type SubscriptionSource } from "./types";

/** 仓库构造参数。 */
export interface SubscriptionAccountStoreOptions {
	/** 数据库持久化；生产装配必须传入。 */
	readonly persistence?: SubscriptionAccountPersistence;
	/** auth 目录；只用于一次性导入旧文件与定位旧 config.yaml。 */
	readonly authDir?: string;
}

/** 旧 auth 文件后缀。 */
const ACCOUNT_SUFFIX = ".json";
/** 旧回收站目录名。 */
const TRASH_DIR = ".trash";
/** 旧文件导入完成标记；导入只在数据库标记前执行一次。 */
export const LEGACY_ACCOUNT_IMPORT_STATE_PARAM = "subscription_account_legacy_import_state";
/** 账号键长度上限，避免把超长字符串当键写进数据库。 */
const MAX_ACCOUNT_KEY_LENGTH = 200;

/**
 * 从 auth 文件内容判断来源。
 * @param raw - 已解析的 JSON
 */
function sourceOf(raw: Record<string, unknown>): SubscriptionSource | undefined {
	const candidates = [raw["type"], raw["provider"], raw["source"]];
	for (const candidate of candidates) {
		if (typeof candidate !== "string") {
			continue;
		}
		const normalized = candidate.trim().toLowerCase();
		if (isSubscriptionSource(normalized)) {
			return normalized;
		}
		if (normalized === "codex-device" || normalized === "codex_oauth") {
			return "codex";
		}
		if (normalized === "kimi-ai" || normalized === "kimi_ai") {
			return "kimi";
		}
	}
	return undefined;
}

/**
 * 从常见字段推导 access token 到期时间。
 * @param raw - auth JSON
 */
function expiresAtOf(raw: Record<string, unknown>): number | undefined {
	for (const key of ["expires_at", "expired", "expiry", "expires"]) {
		const value = raw[key];
		if (typeof value === "number" && Number.isFinite(value)) {
			return value > 10_000_000_000 ? value : value * 1000;
		}
		if (typeof value === "string" && value.trim()) {
			const parsed = Date.parse(value);
			if (Number.isFinite(parsed)) {
				return parsed;
			}
		}
	}
	const accessToken = raw["access_token"];
	if (typeof accessToken === "string") {
		const payload = accessToken.split(".")[1];
		if (payload) {
			try {
				const decoded: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
				if (decoded && typeof decoded === "object") {
					const exp = (decoded as Record<string, unknown>)["exp"];
					if (typeof exp === "number" && Number.isFinite(exp)) {
						return exp > 10_000_000_000 ? exp : exp * 1000;
					}
				}
			} catch {
				return undefined;
			}
		}
	}
	return undefined;
}

/**
 * 账号 ID：来源与账号键的稳定摘要，沿用旧 `auth_index` 的派生方式。
 * @param source - 订阅来源
 * @param key - 账号键
 */
function accountId(source: SubscriptionSource, key: string): string {
	return createHash("sha256").update(source).update("\0").update(key).digest("hex").slice(0, 16);
}

/**
 * 数据库行 → 领域账号。
 * @param row - 账号行
 */
function toAccount(row: StoredSubscriptionAccount): SubscriptionAccount {
	const raw = row.payload;
	const weightRaw = raw["weight"];
	const weight = typeof weightRaw === "number" && Number.isFinite(weightRaw) && weightRaw >= 0 ? Math.min(1_000_000, weightRaw) : 1;
	const priorityRaw = raw["priority"];
	const priority =
		typeof priorityRaw === "number" && Number.isFinite(priorityRaw)
			? Math.trunc(priorityRaw)
			: typeof priorityRaw === "string" && priorityRaw.trim() && Number.isFinite(Number(priorityRaw))
				? Math.trunc(Number(priorityRaw))
				: 0;
	return {
		id: row.id,
		source: row.source,
		key: row.key,
		disabled: raw["disabled"] === true,
		weight: weight,
		priority: priority,
		status: typeof raw["status"] === "string" ? raw["status"] : undefined,
		lastError: typeof raw["last_error"] === "string" ? raw["last_error"] : undefined,
		refreshFailures: typeof raw["refresh_failures"] === "number" ? raw["refresh_failures"] : undefined,
		email: typeof raw["email"] === "string" ? raw["email"] : undefined,
		label: typeof raw["label"] === "string" ? raw["label"] : undefined,
		expiresAt: expiresAtOf(raw),
		updatedAt: row.updatedAt.toISOString(),
		trashedAt: row.trashedAt === null ? undefined : row.trashedAt.toISOString(),
		raw: raw,
	};
}

/** 旧文件导入结果。 */
export interface LegacyAccountImport {
	/** 新导入的有效账号数。 */
	readonly imported: number;
	/** 新导入的回收站账号数。 */
	readonly trashed: number;
	/** 已存在或无法表示而跳过的文件数。 */
	readonly skipped: number;
}

/**
 * 账号仓库。
 */
export class SubscriptionAccountStore {
	private readonly _authDir: string;
	private readonly _persistence: SubscriptionAccountPersistence;
	private readonly _locks = new Map<string, Promise<void>>();

	/**
	 * @param options - 持久化与旧目录
	 */
	constructor(options: SubscriptionAccountStoreOptions = {}) {
		this._authDir = options.authDir ?? defaultSubscriptionAuthDir();
		if (options.persistence !== undefined) {
			this._persistence = options.persistence;
		} else if (process.env["NODE_ENV"] === "production") {
			throw new Error("订阅账号仓库必须以数据库持久化装配（缺少 persistence）");
		} else {
			this._persistence = new MemorySubscriptionAccountPersistence();
		}
	}

	/** auth 根目录；只用于旧文件导入与旧 config.yaml 定位。 */
	get authDir(): string {
		return this._authDir;
	}

	/**
	 * 列出有效账号。
	 * @param source - 可选来源过滤
	 * @param includeTrashed - 是否附带回收站账号
	 */
	async list(source?: SubscriptionSource, includeTrashed = false): Promise<SubscriptionAccount[]> {
		const rows = await this._persistence.list(source);
		const accounts = rows.filter((row) => includeTrashed || row.trashedAt === null).map(toAccount);
		return accounts.sort((left, right) => left.key.localeCompare(right.key));
	}

	/**
	 * 列出回收站账号。
	 * @param source - 可选来源过滤
	 */
	async listTrashed(source?: SubscriptionSource): Promise<SubscriptionAccount[]> {
		const rows = await this._persistence.list(source);
		return rows
			.filter((row) => row.trashedAt !== null)
			.map(toAccount)
			.sort((left, right) => left.key.localeCompare(right.key));
	}

	/**
	 * 按账号 ID 查找（含回收站）。
	 * @param id - 账号 ID
	 */
	async findById(id: string): Promise<SubscriptionAccount | undefined> {
		const row = await this._persistence.find(id);
		return row === undefined ? undefined : toAccount(row);
	}

	/**
	 * 按账号键查找账号；默认只看有效账号。
	 * @param key - 账号键
	 * @param source - 可选来源过滤
	 * @param includeTrashed - 有效账号不存在时是否回落到回收站行
	 */
	async findByKey(key: string, source?: SubscriptionSource, includeTrashed = false): Promise<SubscriptionAccount | undefined> {
		const rows = await this._rowsByKey(key, source);
		const row = rows.find((candidate) => candidate.trashedAt === null) ?? (includeTrashed ? rows[0] : undefined);
		return row === undefined ? undefined : toAccount(row);
	}

	/**
	 * 键是否已被占用（有效或回收站）。
	 * @param key - 账号键
	 * @param source - 可选来源过滤
	 */
	async keyExists(key: string, source?: SubscriptionSource): Promise<boolean> {
		return (await this._rowsByKey(key, source)).length > 0;
	}

	/**
	 * 读取原始 auth JSON。
	 * @param ref - 账号 ID 或账号键
	 */
	async readRaw(ref: string): Promise<Record<string, unknown>> {
		return (await this._resolve(ref)).payload;
	}

	/**
	 * 写入账号：键已存在时更新正文并保留回收站状态，否则按来源新建。
	 * @param key - 账号键
	 * @param raw - 完整 JSON
	 */
	async writeRaw(key: string, raw: Record<string, unknown>): Promise<void> {
		const accountKey = normalizeKey(key);
		const source = sourceOf(raw);
		if (source === undefined) {
			throw ApiError.badRequest("订阅账号来源无法识别");
		}
		const rows = await this._rowsByKey(accountKey, source);
		const active = rows.find((row) => row.trashedAt === null);
		if (active !== undefined) {
			await this._persistence.update(active.id, { payload: raw });
			return;
		}
		const trashed = rows[0];
		if (trashed !== undefined) {
			// 已回收的账号再次被写入（例如重新登录同名账号）：只换正文，仍留在回收站，
			// 是否恢复由管理面显式操作决定。
			await this._persistence.update(trashed.id, { payload: raw });
			return;
		}
		await this._persistence.insert({ id: accountId(source, accountKey), source: source, key: accountKey, payload: raw });
	}

	/**
	 * 更新单个字段；null 表示删除。
	 * @param ref - 账号 ID 或账号键
	 * @param patch - 字段补丁
	 */
	async patchRaw(ref: string, patch: Record<string, unknown | null>): Promise<Record<string, unknown>> {
		// 管理写入必须与 OAuth 刷新共用同一把锁；否则刷新期间的读-改-写会覆盖
		// 刚刚写入的 disabled/weight，账号被"复活"或权重回退。
		return await this.withAccountLock(ref, 35_000, async () => {
			const row = await this._resolve(ref);
			const raw = { ...row.payload };
			for (const [field, value] of Object.entries(patch)) {
				if (value === null) {
					delete raw[field];
				} else {
					raw[field] = value;
				}
			}
			await this._persistence.update(row.id, { payload: raw });
			return raw;
		});
	}

	/**
	 * 设置禁用状态。
	 * @param ref - 账号 ID 或账号键
	 * @param disabled - 是否禁用
	 */
	async setDisabled(ref: string, disabled: boolean): Promise<void> {
		await this.patchRaw(ref, { disabled: disabled });
	}

	/**
	 * 设置调度权重；null 删除权重字段。
	 * @param ref - 账号 ID 或账号键
	 * @param weight - 权重
	 */
	async setWeight(ref: string, weight: number | null): Promise<void> {
		await this.patchRaw(ref, { weight: weight });
	}

	/**
	 * 设置账号展示邮箱；null 删除该字段。
	 *
	 * Key 型 Provider 的上游不返回身份，管理员登记后账号页与额度卡片用它作为账号名称。
	 * @param ref - 账号 ID 或账号键
	 * @param email - 邮箱或 null
	 */
	async setEmail(ref: string, email: string | null): Promise<void> {
		await this.patchRaw(ref, { email: email });
	}

	/**
	 * 移入回收站。
	 * @param ref - 账号 ID 或账号键
	 */
	async archive(ref: string): Promise<void> {
		const row = await this._resolve(ref);
		if (row.trashedAt !== null) {
			return;
		}
		await this._persistence.update(row.id, { trashedAt: new Date() });
	}

	/**
	 * 从回收站恢复；恢复到已被占用的账号键时拒绝。
	 * @param ref - 账号 ID 或账号键
	 */
	async restore(ref: string): Promise<void> {
		const row = await this._resolve(ref);
		if (row.trashedAt === null) {
			return;
		}
		const rows = await this._persistence.findByKey(row.source, row.key);
		if (rows.some((candidate) => candidate.id !== row.id && candidate.trashedAt === null)) {
			throw ApiError.conflict("同名订阅账号已存在，无法恢复");
		}
		await this._persistence.update(row.id, { trashedAt: null });
	}

	/**
	 * 删除账号行（仅测试/清理使用；管理面走回收站）。
	 * @param ref - 账号 ID 或账号键
	 */
	async remove(ref: string): Promise<void> {
		const row = await this._resolve(ref);
		await this._persistence.remove(row.id);
	}

	/**
	 * 检查同来源同 key 是否已存在（只看有效账号）。
	 * @param source - 来源
	 * @param key - API key
	 * @param exceptKey - 排除的账号键
	 */
	async hasApiKey(source: SubscriptionSource, key: string, exceptKey?: string): Promise<boolean> {
		const accounts = await this.list(source);
		return accounts.some(
			(account) =>
				account.key !== exceptKey &&
				typeof account.raw["api_key"] === "string" &&
				(account.raw["api_key"] as string).trim() === key.trim(),
		);
	}

	/**
	 * 取得账号级互斥锁；刷新 token 时避免并发读-改-写。
	 * @param ref - 账号 ID 或账号键
	 * @param timeoutMs - 等待上限
	 * @param action - 持锁执行的操作
	 */
	async withAccountLock<T>(ref: string, timeoutMs: number, action: () => Promise<T>): Promise<T> {
		const id = await this._lockKey(ref);
		const previous = this._locks.get(id) ?? Promise.resolve();
		let release: () => void = () => undefined;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const queued = previous.then(() => gate);
		this._locks.set(id, queued);
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				previous,
				new Promise<never>((_resolve, reject) => {
					timer = setTimeout(() => reject(ApiError.unavailable("订阅账号正在刷新，请稍后重试")), timeoutMs);
				}),
			]);
		} catch (error) {
			release();
			if (this._locks.get(id) === queued) {
				this._locks.delete(id);
			}
			throw error;
		} finally {
			if (timer !== undefined) {
				clearTimeout(timer);
			}
		}
		try {
			return await action();
		} finally {
			release();
			if (this._locks.get(id) === queued) {
				this._locks.delete(id);
			}
		}
	}

	/**
	 * 删除某个账号在旧 auth 目录中的全部冷备份副本。
	 *
	 * 正常运行时不会更新这些文件，但永久删除必须同时清掉它们，否则旧镜像回滚或
	 * 一次性导入仍可能把账号带回来。回收站里的历史副本也一并删除。
	 * @param key - 账号键
	 */
	async removeLegacyBackups(key: string): Promise<void> {
		const accountKey = legacyBackupKey(key);
		const candidates = [path.join(this._authDir, accountKey)];
		const trashDirectory = path.join(this._authDir, TRASH_DIR);
		let trashEntries: Dirent[];
		try {
			trashEntries = await readdir(trashDirectory, { withFileTypes: true });
		} catch (error: unknown) {
			if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
				throw error;
			}
			trashEntries = [];
		}
		for (const entry of trashEntries) {
			if (entry.isFile() && entry.name.replace(/^\d+-/, "") === accountKey) {
				candidates.push(path.join(trashDirectory, entry.name));
			}
		}
		await Promise.all(
			candidates.map((candidate) =>
				unlink(candidate).catch((error: unknown) => {
					if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
						throw error;
					}
				}),
			),
		);
	}

	/**
	 * 一次性导入旧 auth 目录与 `.trash/` 中尚未入库的账号。
	 *
	 * 回收站优先：旧实现的设置保存会把 `SubscriptionAccountKeys` 里的 key 重新投影成有效
	 * 文件，导致账号回收后又出现同名有效文件。因此同一个键既有回收站副本又有有效文件时，
	 * 按回收站副本导入（正文取较新的有效文件，`trashed_at` 取最近一次回收时间），
	 * 否则用户刚回收的账号会在升级后自己复活。
	 *
	 * 幂等：同一 (来源, 账号键, 有效性) 已存在时跳过。文件保留在磁盘作为冷备份，
	 * 导入后运行期不再读写它们。
	 * @returns 导入统计
	 */
	async importLegacyFiles(): Promise<LegacyAccountImport> {
		const result: { imported: number; trashed: number; skipped: number } = { imported: 0, trashed: 0, skipped: 0 };
		const revoked = await this._legacyTrashEntries(result);
		for (const entry of await readdir(this._authDir, { withFileTypes: true }).catch(() => [])) {
			if (!entry.isFile() || !entry.name.endsWith(ACCOUNT_SUFFIX)) {
				continue;
			}
			const key = entry.name;
			const parsed = await parseLegacyFile(path.join(this._authDir, key), key);
			if (parsed === undefined) {
				result.skipped += 1;
				continue;
			}
			const pair = `${parsed.source}\0${key}`;
			const trashed = revoked.get(pair);
			revoked.delete(pair);
			// 正文取磁盘上的最新副本（有效文件可能被旧投影重写），有效性取回收站副本。
			const outcome = await this._insertLegacyRow(parsed.source, key, parsed.raw, trashed?.at ?? null);
			result[outcome] += 1;
		}
		for (const [pair, trashed] of revoked) {
			const separator = pair.indexOf("\0");
			const source = pair.slice(0, separator) as SubscriptionSource;
			const key = pair.slice(separator + 1);
			const outcome = await this._insertLegacyRow(source, key, trashed.raw, trashed.at);
			result[outcome] += 1;
		}
		return result;
	}

	/**
	 * 读取回收站目录：同一个键被回收多次时取最近一次的时间与正文。
	 * @param result - 导入统计
	 */
	private async _legacyTrashEntries(result: { skipped: number }): Promise<Map<string, { at: Date; raw: Record<string, unknown> }>> {
		const revoked = new Map<string, { at: Date; raw: Record<string, unknown> }>();
		const directory = path.join(this._authDir, TRASH_DIR);
		for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
			if (!entry.isFile() || !entry.name.endsWith(ACCOUNT_SUFFIX)) {
				continue;
			}
			const key = entry.name.replace(/^\d+-/, "");
			const parsed = await parseLegacyFile(path.join(directory, entry.name), key);
			if (parsed === undefined) {
				result.skipped += 1;
				continue;
			}
			const pair = `${parsed.source}\0${key}`;
			const trashedAt = trashedAtOf(entry.name);
			const previous = revoked.get(pair);
			if (previous === undefined || trashedAt.getTime() > previous.at.getTime()) {
				revoked.set(pair, { at: trashedAt, raw: parsed.raw });
			}
		}
		return revoked;
	}

	/**
	 * 插入一行旧账号；同一键与有效性已存在、或派生 ID 已被占用时跳过。
	 * @param source - 订阅来源
	 * @param key - 账号键
	 * @param raw - auth JSON 原文
	 * @param trashedAt - 回收站时间；为空表示有效
	 */
	private async _insertLegacyRow(
		source: SubscriptionSource,
		key: string,
		raw: Record<string, unknown>,
		trashedAt: Date | null,
	): Promise<"imported" | "trashed" | "skipped"> {
		const rows = await this._persistence.findByKey(source, key);
		if (rows.some((row) => (row.trashedAt === null) === (trashedAt === null))) {
			return "skipped";
		}
		const id = accountId(source, key);
		if (await this._persistence.find(id)) {
			// 同一账号键的回收站副本与有效行共用派生 ID，无法用一行表示两份。
			return "skipped";
		}
		await this._persistence.insert({ id: id, source: source, key: key, payload: raw, trashedAt: trashedAt });
		return trashedAt === null ? "imported" : "trashed";
	}

	/**
	 * 读取并校验一行；不存在时按管理面文案报错。
	 * @param ref - 账号 ID 或账号键
	 */
	private async _resolve(ref: string): Promise<StoredSubscriptionAccount> {
		const row = await this._findRow(ref);
		if (row === undefined) {
			throw ApiError.notFound("订阅账号不存在");
		}
		return row;
	}

	/**
	 * 解析账号 ID 或账号键。
	 * @param ref - 账号 ID 或账号键
	 */
	private async _findRow(ref: string): Promise<StoredSubscriptionAccount | undefined> {
		const value = typeof ref === "string" ? ref.trim() : "";
		if (!value || value.includes("\0") || value.includes("..")) {
			throw ApiError.badRequest("订阅账号标识无效");
		}
		if (value.startsWith(TRASH_DIR + "/") || value.includes("/")) {
			throw ApiError.badRequest("订阅账号标识无效");
		}
		const byId = await this._persistence.find(value);
		if (byId !== undefined) {
			return byId;
		}
		const rows = (await this._persistence.list()).filter((row) => row.key === value);
		return rows.find((row) => row.trashedAt === null) ?? rows[0];
	}

	/**
	 * 按账号键查行；来源可选。
	 * @param key - 账号键
	 * @param source - 可选来源
	 */
	private async _rowsByKey(key: string, source?: SubscriptionSource): Promise<StoredSubscriptionAccount[]> {
		if (source !== undefined) {
			return await this._persistence.findByKey(source, key);
		}
		return (await this._persistence.list()).filter((row) => row.key === key);
	}

	/**
	 * 锁的键：能解析成账号 ID 时用 ID，避免同一账号被 ID 与键分别加锁。
	 * @param ref - 账号 ID 或账号键
	 */
	private async _lockKey(ref: string): Promise<string> {
		try {
			const row = await this._findRow(ref);
			return row === undefined ? ref : row.id;
		} catch {
			return ref;
		}
	}
}

/**
 * 规范化账号键：只接受不含目录的单段文件名。
 * @param key - 账号键
 * @throws {ApiError} 键为空、过长或含路径分隔符时抛出
 */
function normalizeKey(key: string): string {
	const value = typeof key === "string" ? key.trim() : "";
	if (
		!value ||
		value.length > MAX_ACCOUNT_KEY_LENGTH ||
		value.includes("\0") ||
		value.includes("/") ||
		value.includes("\\") ||
		value === "." ||
		value === ".." ||
		!value.endsWith(ACCOUNT_SUFFIX)
	) {
		throw ApiError.badRequest("订阅账号键无效");
	}
	return value;
}

/**
 * 删除冷备份时使用的键校验。
 *
 * 导入没有经过 `normalizeKey` 的 200 字符上限，旧文件名最长可到文件系统的 255；永久删除
 * 不能因为这类历史键而失败。仍然只接受单段 `.json` 文件名，避免越出 auth 目录。
 * @param key - 账号键
 * @throws {ApiError} 键为空、过长或含路径分隔符时抛出
 */
function legacyBackupKey(key: string): string {
	const value = typeof key === "string" ? key.trim() : "";
	if (
		!value ||
		value.length > 255 ||
		value.includes("\0") ||
		value.includes("/") ||
		value.includes("\\") ||
		value === "." ||
		value === ".." ||
		!value.endsWith(ACCOUNT_SUFFIX)
	) {
		throw ApiError.badRequest("订阅账号键无效");
	}
	return value;
}

/**
 * 旧文件名的回收站时间：`<epoch-ms>-<name>`。
 * @param name - 回收站文件名
 */
function trashedAtOf(name: string): Date {
	const separator = name.indexOf("-");
	const epoch = separator > 0 ? Number(name.slice(0, separator)) : Number.NaN;
	return Number.isFinite(epoch) ? new Date(epoch) : new Date();
}

/**
 * 读取并解析一个旧 auth 文件。
 * @param filePath - 绝对路径
 * @param key - 账号键
 */
async function parseLegacyFile(
	filePath: string,
	key: string,
): Promise<{ source: SubscriptionSource; raw: Record<string, unknown> } | undefined> {
	let text: string;
	try {
		text = await readFile(filePath, "utf8");
	} catch {
		return undefined;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(text) as unknown;
	} catch {
		return undefined;
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return undefined;
	}
	const raw = parsed as Record<string, unknown>;
	const source = sourceOf(raw);
	return source === undefined ? undefined : { source: source, raw: raw };
}

/**
 * 解析默认 auth 目录，兼容旧的运行时根目录环境变量。
 */
export function defaultSubscriptionAuthDir(): string {
	const explicit = process.env["SUBSCRIPTION_AUTH_DIR"];
	if (explicit) {
		return explicit;
	}
	const runtimeRoot = process.env["CLIPROXY_RUNTIME_ROOT"];
	if (runtimeRoot) {
		return path.join(runtimeRoot, "auths");
	}
	return "/var/lib/litellm/cliproxy/auths";
}
