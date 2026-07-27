/**
 * DB 配置提供者 — 读取 LiteLLM_Config 表的运行时配置覆盖
 *
 * 对齐 Python `proxy_config.get_config()` 的 DB 配置合并语义：
 * WebUI 上的设置修改（store_prompts、logo、callbacks 等）写入 LiteLLM_Config 表，
 * 优先级高于 yaml 配置文件。数据库是唯一动态真源；每次读取都查询目标行，
 * 不保存跨请求 TTL 缓存。
 */
import { eq } from "drizzle-orm";
import { LiteLLM_Config } from "../../db/schema/config";
import type { DrizzleDb } from "../db/Database";

/**
 *
 */
export type DbConfigParamName = "general_settings" | "litellm_settings" | "router_settings" | "environment_variables" | string;

class DbConfigProvider {
	private _db: DrizzleDb | null = null;

	/**
	 * 初始化（启动时调用一次）。
	 * @param db
	 */
	async initialize(db: DrizzleDb): Promise<void> {
		this._db = db;
	}

	/**
	 * 直接读取 DB 配置参数。
	 * @param paramName - LiteLLM_Config.param_name（general_settings / litellm_settings / ...）
	 */
	async getParam(paramName: DbConfigParamName): Promise<Record<string, unknown>> {
		if (this._db === null) {
			return {};
		}
		const rows = await this._db.select().from(LiteLLM_Config).where(eq(LiteLLM_Config.param_name, paramName)).limit(1);
		const value = rows.at(0)?.param_value;
		return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
	}

	/**
	 * DB 配置是否存在（判断布尔开关时区分"未配置"与"配置为 false"）
	 * @param paramName
	 * @param key
	 */
	async hasParam(paramName: DbConfigParamName, key: string): Promise<boolean> {
		return key in (await this.getParam(paramName));
	}
}

/** 全局单例（容器初始化时注入 DB） */
export const dbConfigProvider = new DbConfigProvider();
