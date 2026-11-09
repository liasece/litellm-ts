import { validateSpendMetadataFields } from "../spend/SpendMetadataFields";
import { validateKeyAliasSettings } from "../management/KeyAliasPolicy";
import { ApiError } from "../core/api/ApiError";
/**
 * LiteLLM_Config 仓库 — WebUI 配置参数的 DB 读写，也是该表的唯一访问点。
 *
 * 对齐 Python `prisma_client.insert_data(table_name="config")`（utils.py:3171-3190）
 * 的 upsert 语义：按 param_name 冲突时更新 param_value。
 * 配置表行数极少（general_settings / litellm_settings / router_settings /
 * environment_variables 等固定 param_name），读取走本仓库维护的进程内副本；
 * 写入成功后同步副本，WebUI 保存的配置因此对下一个请求立即生效。
 */
import { LiteLLM_Config } from "../db/schema/config";
import { BaseRepository } from "../core/db/BaseRepository";
import type { DrizzleDb } from "../core/db/Database";
import { revisionCounterFor, TableCache } from "./internal/TableCache";

/** `LiteLLM_Config` 行。 */
export type ConfigRow = typeof LiteLLM_Config.$inferSelect;

const caches = new WeakMap<object, TableCache<ConfigRow>>();
const repositories = new WeakMap<object, ConfigRepository>();

function cacheFor(db: DrizzleDb): TableCache<ConfigRow> {
	const key = db as unknown as object;
	const existing = caches.get(key);
	if (existing !== undefined) {
		return existing;
	}
	const created = new TableCache<ConfigRow>(() => db.select().from(LiteLLM_Config), revisionCounterFor(key));
	caches.set(key, created);
	return created;
}

/**
 * 取得与数据库连接绑定的配置仓库；同一连接上的所有调用方共享同一份副本。
 * @param db - Drizzle 数据库实例
 */
export function configRepositoryFor(db: DrizzleDb): ConfigRepository {
	const key = db as unknown as object;
	const existing = repositories.get(key);
	if (existing !== undefined) {
		return existing;
	}
	const created = new ConfigRepository(db);
	repositories.set(key, created);
	return created;
}

/**
 *
 */
export class ConfigRepository extends BaseRepository {
	private readonly _cache: TableCache<ConfigRow>;

	/**
	 * @param db - Drizzle 数据库实例（BaseRepository 构造为 protected，显式公开子类构造）
	 */
	constructor(db: DrizzleDb) {
		super(db);
		this._cache = cacheFor(db);
	}

	/** 当前副本版本号，供请求级快照判重。 */
	revision(): number {
		return this._cache.revision();
	}

	/** 读取全部配置参数行；返回共享副本，调用方只读。 */
	async snapshotRows(): Promise<ConfigRow[]> {
		return await this._cache.rows();
	}

	/** 外部直接改库后强制重新装载；应用内写路径不需要调用。 */
	invalidateCache(): void {
		this._cache.invalidate();
	}

	/**
	 * upsert 一个配置参数（按 param_name 冲突更新 param_value）
	 * @param paramName - LiteLLM_Config.param_name
	 * @param value - 参数值（jsonb）
	 */
	async upsertParam(paramName: string, value: unknown): Promise<void> {
		if (value && typeof value === "object" && !Array.isArray(value)) {
			if (paramName === "general_settings") {
				try {
					validateSpendMetadataFields((value as Record<string, unknown>)["spend_logs_metadata_fields"]);
				} catch {
					throw ApiError.badRequest("Invalid spend_logs_metadata_fields configuration");
				}
			}
			if (paramName === "litellm_settings") {
				validateKeyAliasSettings(value as Record<string, unknown>);
			}
		}
		await this._db
			.insert(LiteLLM_Config)
			.values({ param_name: paramName, param_value: value })
			.onConflictDoUpdate({
				target: LiteLLM_Config.param_name,
				set: { param_value: value },
			});
		const snapshot = structuredClone(value);
		this._cache.mutate((rows) => [...rows.filter((row) => row.param_name !== paramName), { param_name: paramName, param_value: snapshot }]);
	}

	/**
	 * 读取配置参数对象；参数不存在或值非对象时返回 null
	 * @param paramName - LiteLLM_Config.param_name
	 */
	async getParam(paramName: string): Promise<Record<string, unknown> | null> {
		const rows = await this._cache.rows();
		const row = rows.find((candidate) => candidate.param_name === paramName);
		const value = row?.param_value;
		return typeof value === "object" && value !== null && !Array.isArray(value) ? structuredClone(value as Record<string, unknown>) : null;
	}

	/**
	 * 删除参数 JSON 中的单个字段并回写（对齐 Python /config/field/delete 的 pop + upsert）。
	 * @param paramName - LiteLLM_Config.param_name
	 * @param fieldName - 待删除字段名
	 * @returns 更新后的参数对象；参数不存在时返回 null
	 */
	async deleteField(paramName: string, fieldName: string): Promise<Record<string, unknown> | null> {
		const current = await this.getParam(paramName);
		if (current === null) {
			return null;
		}
		const next = { ...current };
		delete next[fieldName];
		await this.upsertParam(paramName, next);
		return next;
	}
}
