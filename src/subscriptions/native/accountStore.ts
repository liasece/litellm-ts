/**
 * 订阅账号仓库。
 *
 * 账号仍以 auth JSON 文件为唯一持久化格式，目录与字段保持与旧运行时一致，
 * 以便滚动升级、回滚与手工导入继续可用。仓库只负责读写与元数据归一化，
 * 调度、刷新与协议执行由其他模块负责。
 */

import { createHash } from "node:crypto";
import { chmod, mkdir, open, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { ApiError } from "../../core/api/ApiError";
import { isSubscriptionSource, type SubscriptionAccount, type SubscriptionSource } from "./types";

/** 仓库构造参数。 */
export interface SubscriptionAccountStoreOptions {
	/** auth 目录；生产默认 /var/lib/litellm/cliproxy/auths。 */
	readonly authDir: string;
}

/** 一个账号文件的解析结果。 */
interface ParsedAccountFile {
	readonly source: SubscriptionSource;
	readonly account: SubscriptionAccount;
}

/** 账号文件后缀。 */
const ACCOUNT_SUFFIX = ".json";
/** 回收站目录名。 */
const TRASH_DIR = ".trash";

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
						return exp * 1000;
					}
				}
			} catch {
				// 非 JWT access token 时忽略。
			}
		}
	}
	return undefined;
}

/**
 * 账号稳定 ID：来源 + 文件名，文件改名会得到新 ID。
 * @param source - 来源
 * @param fileName - 文件名
 */
function accountId(source: SubscriptionSource, fileName: string): string {
	return createHash("sha256").update(source).update("\0").update(fileName).digest("hex").slice(0, 16);
}

/**
 * 读取并解析一个账号文件。
 * @param filePath - 绝对路径
 * @param fileName - 文件名
 */
async function parseAccountFile(filePath: string, fileName: string): Promise<ParsedAccountFile | undefined> {
	let rawText: string;
	try {
		rawText = await readFile(filePath, "utf8");
	} catch {
		return undefined;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawText) as unknown;
	} catch {
		return undefined;
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		return undefined;
	}
	const raw = parsed as Record<string, unknown>;
	const source = sourceOf(raw);
	if (!source) {
		return undefined;
	}
	const disabled = raw["disabled"] === true;
	const weightRaw = raw["weight"];
	const weight = typeof weightRaw === "number" && Number.isFinite(weightRaw) && weightRaw >= 0 ? Math.min(1_000_000, weightRaw) : 1;
	const priorityRaw = raw["priority"];
	const priority =
		typeof priorityRaw === "number" && Number.isFinite(priorityRaw)
			? Math.trunc(priorityRaw)
			: typeof priorityRaw === "string" && priorityRaw.trim() && Number.isFinite(Number(priorityRaw))
				? Math.trunc(Number(priorityRaw))
				: 0;
	const email = typeof raw["email"] === "string" ? raw["email"] : undefined;
	const label = typeof raw["label"] === "string" ? raw["label"] : undefined;
	const expiresAt = expiresAtOf(raw);
	return {
		source: source,
		account: {
			id: accountId(source, fileName),
			source: source,
			fileName: fileName,
			path: filePath,
			disabled: disabled,
			weight: weight,
			priority: priority,
			status: typeof raw["status"] === "string" ? raw["status"] : undefined,
			lastError: typeof raw["last_error"] === "string" ? raw["last_error"] : undefined,
			refreshFailures: typeof raw["refresh_failures"] === "number" ? raw["refresh_failures"] : undefined,
			email: email,
			label: label,
			expiresAt: expiresAt,
			raw: raw,
		},
	};
}

/**
 * 账号仓库。
 */
export class SubscriptionAccountStore {
	private readonly _authDir: string;
	private readonly _trashDir: string;

	constructor(options: SubscriptionAccountStoreOptions) {
		this._authDir = options.authDir;
		this._trashDir = path.join(this._authDir, TRASH_DIR);
	}

	/** auth 根目录。 */
	get authDir(): string {
		return this._authDir;
	}

	/** 回收站目录。 */
	get trashDir(): string {
		return this._trashDir;
	}

	/**
	 * 确保目录存在。
	 */
	async ensureDirectories(): Promise<void> {
		await mkdir(this._authDir, { recursive: true, mode: 0o700 });
	}

	/**
	 * 列出账号。
	 * @param source - 可选来源过滤
	 * @param includeTrashed - 是否包含回收站
	 */
	async list(source?: SubscriptionSource, includeTrashed = false): Promise<SubscriptionAccount[]> {
		await this.ensureDirectories();
		const entries = await readdir(this._authDir, { withFileTypes: true });
		const accounts: SubscriptionAccount[] = [];
		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.endsWith(ACCOUNT_SUFFIX)) {
				continue;
			}
			const parsed = await parseAccountFile(path.join(this._authDir, entry.name), entry.name);
			if (parsed && (source === undefined || parsed.source === source)) {
				accounts.push(parsed.account);
			}
		}
		if (includeTrashed) {
			for (const account of await this._listTrashed(source)) {
				accounts.push(account);
			}
		}
		accounts.sort((left, right) => left.fileName.localeCompare(right.fileName));
		return accounts;
	}

	/**
	 * 列出回收站账号。
	 * @param source - 可选来源过滤
	 */
	async listTrashed(source?: SubscriptionSource): Promise<SubscriptionAccount[]> {
		return this._listTrashed(source);
	}

	private async _listTrashed(source?: SubscriptionSource): Promise<SubscriptionAccount[]> {
		const accounts: SubscriptionAccount[] = [];
		let entries;
		try {
			entries = await readdir(this._trashDir, { withFileTypes: true });
		} catch {
			return accounts;
		}
		for (const entry of entries) {
			if (!entry.isFile() || !entry.name.endsWith(ACCOUNT_SUFFIX)) {
				continue;
			}
			const separator = entry.name.indexOf("-");
			const originalName = separator >= 0 ? entry.name.slice(separator + 1) : entry.name;
			const parsed = await parseAccountFile(path.join(this._trashDir, entry.name), originalName);
			if (parsed && (source === undefined || parsed.source === source)) {
				accounts.push({ ...parsed.account, path: path.join(this._trashDir, entry.name) });
			}
		}
		return accounts;
	}

	/**
	 * 按 ID 查找活跃账号。
	 * @param id - 账号 ID
	 */
	async findById(id: string): Promise<SubscriptionAccount | undefined> {
		const accounts = await this.list();
		return accounts.find((account) => account.id === id);
	}

	/**
	 * 按文件名查找活跃账号。
	 * @param fileName - 文件名
	 */
	async findByFileName(fileName: string): Promise<SubscriptionAccount | undefined> {
		const parsed = await parseAccountFile(path.join(this._authDir, path.basename(fileName)), path.basename(fileName));
		return parsed?.account;
	}

	/**
	 * 读取原始 auth JSON。
	 * @param fileName - 文件名
	 */
	async readRaw(fileName: string): Promise<Record<string, unknown>> {
		const filePath = path.join(this._authDir, path.basename(fileName));
		let text: string;
		try {
			text = await readFile(filePath, "utf8");
		} catch {
			throw ApiError.notFound("订阅账号不存在");
		}
		const parsed: unknown = JSON.parse(text) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			throw ApiError.unavailable("订阅账号文件格式无效");
		}
		return parsed as Record<string, unknown>;
	}

	/**
	 * 原子写入账号文件，保留未知字段。
	 * @param fileName - 文件名
	 * @param raw - 完整 JSON
	 */
	async writeRaw(fileName: string, raw: Record<string, unknown>): Promise<void> {
		await this.ensureDirectories();
		const safeName = path.basename(fileName);
		if (!safeName.endsWith(ACCOUNT_SUFFIX)) {
			throw ApiError.badRequest("订阅账号文件名无效");
		}
		const filePath = path.join(this._authDir, safeName);
		const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
		await writeFile(tempPath, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 });
		await chmod(tempPath, 0o600);
		await rename(tempPath, filePath);
	}

	/**
	 * 更新单个字段并原子写回。
	 * @param fileName - 文件名
	 * @param patch - 字段补丁；null 表示删除
	 */
	async patchRaw(fileName: string, patch: Record<string, unknown | null>): Promise<Record<string, unknown>> {
		// 管理写入必须与 OAuth 刷新共用文件锁；否则刷新期间的读-改-写会覆盖
		// 刚刚写入的 disabled/weight，账号被"复活"或权重回退。
		return await this.withFileLock(fileName, 35_000, async () => {
			const raw = await this.readRaw(fileName);
			for (const [key, value] of Object.entries(patch)) {
				if (value === null) {
					delete raw[key];
				} else {
					raw[key] = value;
				}
			}
			await this.writeRaw(fileName, raw);
			return raw;
		});
	}

	/**
	 * 设置禁用状态。
	 * @param fileName - 文件名
	 * @param disabled - 是否禁用
	 */
	async setDisabled(fileName: string, disabled: boolean): Promise<void> {
		await this.patchRaw(fileName, { disabled: disabled });
	}

	/**
	 * 设置调度权重；null 删除权重字段。
	 * @param fileName - 文件名
	 * @param weight - 权重
	 */
	async setWeight(fileName: string, weight: number | null): Promise<void> {
		await this.patchRaw(fileName, { weight: weight });
	}

	/**
	 * 归档到回收站。
	 * @param fileName - 文件名
	 */
	async archive(fileName: string): Promise<void> {
		await this.ensureDirectories();
		await mkdir(this._trashDir, { recursive: true, mode: 0o700 });
		const safeName = path.basename(fileName);
		const sourcePath = path.join(this._authDir, safeName);
		try {
			await stat(sourcePath);
		} catch {
			throw ApiError.notFound("订阅账号不存在");
		}
		const target = path.join(this._trashDir, `${Date.now()}-${safeName}`);
		await rename(sourcePath, target);
	}

	/**
	 * 从回收站恢复；目标已存在时拒绝覆盖。
	 * @param fileName - 回收站中展示的原始文件名
	 */
	async restore(fileName: string): Promise<void> {
		const safeName = path.basename(fileName);
		const entries = await readdir(this._trashDir, { withFileTypes: true }).catch(() => []);
		const candidates = entries
			.filter((entry) => entry.isFile() && entry.name.endsWith(`-${safeName}`))
			.sort((left, right) => right.name.localeCompare(left.name));
		for (const candidate of candidates) {
			const source = path.join(this._trashDir, candidate.name);
			const target = path.join(this._authDir, safeName);
			try {
				await stat(target);
				throw ApiError.conflict("同名订阅账号已存在，无法恢复");
			} catch (error) {
				if (error instanceof ApiError) {
					throw error;
				}
			}
			await rename(source, target);
			return;
		}
		throw ApiError.notFound("回收站中不存在该订阅账号");
	}

	/**
	 * 检查同来源同 key 是否已存在。
	 * @param source - 来源
	 * @param key - API key
	 * @param exceptFileName - 排除的文件
	 */
	async hasApiKey(source: SubscriptionSource, key: string, exceptFileName?: string): Promise<boolean> {
		const accounts = await this.list(source);
		return accounts.some(
			(account) =>
				account.fileName !== exceptFileName &&
				typeof account.raw["api_key"] === "string" &&
				(account.raw["api_key"] as string).trim() === key.trim(),
		);
	}

	/**
	 * 获取账号文件锁；刷新 token 时避免并发写。
	 * @param fileName - 文件名
	 * @param timeoutMs - 等待上限
	 * @param action - 持锁执行的操作
	 */
	async withFileLock<T>(fileName: string, timeoutMs: number, action: () => Promise<T>): Promise<T> {
		const lockPath = path.join(this._authDir, `${path.basename(fileName)}.lock`);
		const started = Date.now();
		let handle;
		for (;;) {
			try {
				handle = await open(lockPath, "wx", 0o600);
				break;
			} catch (error) {
				const code = (error as { code?: string }).code;
				if (code !== "EEXIST") {
					throw error;
				}
				// 进程崩溃不会执行 finally，锁文件会永久残留。超过 60s 的锁视为
				// 失效并抢占；正常情况下刷新 HTTP 超时远小于该阈值。
				const lockStat = await stat(lockPath).catch(() => undefined);
				if (lockStat && Date.now() - lockStat.mtimeMs > 60_000) {
					await unlink(lockPath).catch(() => undefined);
					continue;
				}
				if (Date.now() - started > timeoutMs) {
					throw ApiError.unavailable("订阅账号正在刷新，请稍后重试");
				}
				await new Promise((resolve) => setTimeout(resolve, 50));
			}
		}
		try {
			return await action();
		} finally {
			await handle.close().catch(() => undefined);
			await unlink(lockPath).catch(() => undefined);
		}
	}

	/**
	 * 删除账号文件（仅测试/清理使用；管理面走归档）。
	 * @param fileName - 文件名
	 */
	async remove(fileName: string): Promise<void> {
		await rm(path.join(this._authDir, path.basename(fileName)), { force: true });
	}
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
