/**
 * 运行时配置表缓存 — 配置、模型部署、凭据三张热表的进程内副本。
 *
 * 缓存归属 repository 层：写方法成功后立即更新或失效对应条目，下一次读取重新装载，
 * 因此应用内的配置变更（WebUI 保存）对下一个请求立刻生效，没有 TTL 窗口。
 * 若有人绕过应用直接改库，由惰性安全刷新在 SAFETY_REFRESH_MS 内兜底。
 *
 * 冷启动装载失败时向上抛错，保持「数据库不可用即 fail closed」的原有语义；
 * 只有已经持有副本之后的后台刷新失败才保留旧副本并记录告警。
 * 缓存与数据库连接一一绑定（同一连接共享一份），不同实例与测试互不影响。
 */
import { createModuleLogger } from "../core/utils/logger";
import type { DrizzleDb } from "../core/db/Database";
import { LiteLLM_Config } from "../db/schema/config";
import { LiteLLM_CredentialsTable } from "../db/schema/credentials";
import { LiteLLM_ProxyModelTable } from "../db/schema/proxyModels";

const logger = createModuleLogger("RuntimeConfigCache");

/** 绕过应用直接改库时，最迟多久能被读到。 */
export const SAFETY_REFRESH_MS = 60_000;

/** `LiteLLM_Config` 行。 */
export type RuntimeConfigRow = typeof LiteLLM_Config.$inferSelect;
/** `LiteLLM_ProxyModelTable` 行。 */
export type RuntimeModelRow = typeof LiteLLM_ProxyModelTable.$inferSelect;
/** `LiteLLM_CredentialsTable` 行。 */
export type RuntimeCredentialRow = typeof LiteLLM_CredentialsTable.$inferSelect;

type TableKey = "config" | "models" | "credentials";

/**
 * 三张运行时配置热表的进程内副本。
 *
 * 读写语义：
 * - 读取：首次或失效后装载一次，并发读取合并为一次查询；
 * - 写入：调用方在数据库写入成功后调用 `applyConfigParam` / `invalidate*`，副本立即跟上；
 * - 冷启动失败：抛错（fail closed）；已有副本时的后台刷新失败：保留副本并告警。
 */
export class RuntimeConfigCache {
	private _configRows: RuntimeConfigRow[] | null = null;
	private _modelRows: RuntimeModelRow[] | null = null;
	private _credentialRows: RuntimeCredentialRow[] | null = null;
	private _revision = 0;
	private _refreshedAt = 0;
	private _refreshing = false;
	private readonly _inflight = new Map<TableKey, Promise<void>>();

	/** @param _db - 缓存所属的数据库连接。 */
	constructor(private readonly _db: DrizzleDb) {}

	/** 当前副本版本号；每次装载或失效都会递增，供请求级快照判重。 */
	revision(): number {
		return this._revision;
	}

	/** 读取全部配置参数行（`LiteLLM_Config`）。 */
	async configRows(): Promise<RuntimeConfigRow[]> {
		return await this._rowsOrLoad<RuntimeConfigRow>("config");
	}

	/** 读取全部模型部署行（`LiteLLM_ProxyModelTable`）。 */
	async modelRows(): Promise<RuntimeModelRow[]> {
		return await this._rowsOrLoad<RuntimeModelRow>("models");
	}

	/** 读取全部命名凭据行（`LiteLLM_CredentialsTable`）。 */
	async credentialRows(): Promise<RuntimeCredentialRow[]> {
		return await this._rowsOrLoad<RuntimeCredentialRow>("credentials");
	}

	/**
	 * 配置参数写入成功后同步副本，使下一个请求读到新值。
	 * 副本尚未装载时无需处理，下一次读取会装载最新值。
	 * @param paramName - `LiteLLM_Config.param_name`
	 * @param value - 参数值（jsonb）
	 */
	applyConfigParam(paramName: string, value: unknown): void {
		if (this._configRows === null) {
			return;
		}
		const next = this._configRows.filter((row) => row.param_name !== paramName);
		next.push({ param_name: paramName, param_value: value } as RuntimeConfigRow);
		this._configRows = next;
		this._revision += 1;
	}

	/** 配置写路径无法精确同步时直接失效，下一次读取重新装载。 */
	invalidateConfig(): void {
		if (this._configRows === null) {
			return;
		}
		this._configRows = null;
		this._revision += 1;
	}

	/** 模型部署写路径失效，下一次读取重新装载。 */
	invalidateModels(): void {
		if (this._modelRows === null) {
			return;
		}
		this._modelRows = null;
		this._revision += 1;
	}

	/** 命名凭据写路径失效，下一次读取重新装载。 */
	invalidateCredentials(): void {
		if (this._credentialRows === null) {
			return;
		}
		this._credentialRows = null;
		this._revision += 1;
	}

	/** 三张表全部失效。 */
	invalidateAll(): void {
		const dirty = this._configRows !== null || this._modelRows !== null || this._credentialRows !== null;
		this._configRows = null;
		this._modelRows = null;
		this._credentialRows = null;
		if (dirty) {
			this._revision += 1;
		}
	}

	private async _rowsOrLoad<T>(key: TableKey): Promise<T[]> {
		for (let attempt = 0; attempt < 3; attempt += 1) {
			const cached = this._rows(key) as T[] | null;
			if (cached !== null) {
				this._scheduleSafetyRefresh();
				return cached;
			}
			const pending = this._inflight.get(key);
			if (pending !== undefined) {
				await pending;
				continue;
			}
			const load = this._load(key).finally(() => {
				this._inflight.delete(key);
			});
			this._inflight.set(key, load);
			await load;
		}
		const settled = this._rows(key) as T[] | null;
		if (settled === null) {
			// 连续失效导致副本无法稳定，按 fail closed 处理，不用空配置继续路由。
			throw new Error(`运行时配置缓存无法稳定装载: ${key}`);
		}
		return settled;
	}

	private _rows(key: TableKey): RuntimeConfigRow[] | RuntimeModelRow[] | RuntimeCredentialRow[] | null {
		switch (key) {
			case "config":
				return this._configRows;
			case "models":
				return this._modelRows;
			case "credentials":
				return this._credentialRows;
			default:
				throw new Error(`未知的运行时配置表: ${String(key)}`);
		}
	}

	private async _load(key: TableKey): Promise<void> {
		switch (key) {
			case "config": {
				this._configRows = await this._db.select().from(LiteLLM_Config);
				break;
			}
			case "models": {
				this._modelRows = await this._db.select().from(LiteLLM_ProxyModelTable);
				break;
			}
			case "credentials": {
				this._credentialRows = await this._db.select().from(LiteLLM_CredentialsTable);
				break;
			}
			default:
				throw new Error(`未知的运行时配置表: ${String(key)}`);
		}
		this._refreshedAt = Date.now();
		this._revision += 1;
	}

	private _scheduleSafetyRefresh(): void {
		if (this._refreshing || Date.now() - this._refreshedAt < SAFETY_REFRESH_MS) {
			return;
		}
		this._refreshing = true;
		void this._refreshAll()
			.catch((error: unknown) => {
				logger.warn("运行时配置缓存后台刷新失败，继续使用现有副本", {
					error: error instanceof Error ? error.message : String(error),
				});
			})
			.finally(() => {
				this._refreshing = false;
			});
	}

	private async _refreshAll(): Promise<void> {
		const [configRows, modelRows, credentialRows] = await Promise.all([
			this._db.select().from(LiteLLM_Config),
			this._db.select().from(LiteLLM_ProxyModelTable),
			this._db.select().from(LiteLLM_CredentialsTable),
		]);
		this._configRows = configRows;
		this._modelRows = modelRows;
		this._credentialRows = credentialRows;
		this._refreshedAt = Date.now();
		this._revision += 1;
	}
}

const caches = new WeakMap<object, RuntimeConfigCache>();

/**
 * 取得与给定数据库连接绑定的运行时配置缓存；同一连接上的所有仓库共享一份。
 * @param db - Drizzle 数据库实例
 */
export function runtimeConfigCacheFor(db: DrizzleDb): RuntimeConfigCache {
	const key = db as unknown as object;
	const existing = caches.get(key);
	if (existing !== undefined) {
		return existing;
	}
	const created = new RuntimeConfigCache(db);
	caches.set(key, created);
	return created;
}
