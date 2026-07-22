/**
 * LiteLLM_Config 仓库 — WebUI 配置参数的 DB 读写
 *
 * 对齐 Python `prisma_client.insert_data(table_name="config")`（utils.py:3171-3190）
 * 的 upsert 语义：按 param_name 冲突时更新 param_value。
 * 配置表行数极少（general_settings / litellm_settings / router_settings /
 * environment_variables 等固定 param_name），读取走全表扫描 + 内存过滤，
 * 与 DbConfigProvider 的整表缓存刷新保持一致。
 */
import { LiteLLM_Config } from "../db/schema/config";
import { BaseRepository } from "../core/db/BaseRepository";
import type { DrizzleDb } from "../core/db/Database";

/**
 *
 */
export class ConfigRepository extends BaseRepository {
	/**
	 * @param db - Drizzle 数据库实例（BaseRepository 构造为 protected，显式公开子类构造）
	 */
	constructor(db: DrizzleDb) {
		super(db);
	}

	/**
	 * upsert 一个配置参数（按 param_name 冲突更新 param_value）
	 * @param paramName - LiteLLM_Config.param_name
	 * @param value - 参数值（jsonb）
	 */
	async upsertParam(paramName: string, value: unknown): Promise<void> {
		await this._db
			.insert(LiteLLM_Config)
			.values({ param_name: paramName, param_value: value })
			.onConflictDoUpdate({
				target: LiteLLM_Config.param_name,
				set: { param_value: value },
			});
	}

	/**
	 * 读取配置参数对象；参数不存在或值非对象时返回 null
	 * @param paramName - LiteLLM_Config.param_name
	 */
	async getParam(paramName: string): Promise<Record<string, unknown> | null> {
		const rows = await this._db.select().from(LiteLLM_Config);
		const row = rows.find((r) => r.param_name === paramName);
		const value = row?.param_value;
		return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
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
