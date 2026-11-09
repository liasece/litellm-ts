/**
 * DB 配置提供者 — 读取 LiteLLM_Config 表的运行时配置覆盖
 *
 * 对齐 Python `proxy_config.get_config()` 的 DB 配置合并语义：
 * WebUI 上的设置修改（store_prompts、logo、callbacks 等）写入 LiteLLM_Config 表，
 * 优先级高于 yaml 配置文件。读取走 `RuntimeConfigCache` 的进程内副本，
 * 由配置仓库在写入成功后同步，因此数据库仍是应用内的唯一动态真源且无需每次查询。
 */
import type { DrizzleDb } from "../db/Database";
import { runtimeConfigCacheFor } from "../../repositories/RuntimeConfigCache";

/**
 *
 */
export type DbConfigParamName = "general_settings" | "litellm_settings" | "router_settings" | "environment_variables" | string;

class DbConfigProvider {
	private _db: DrizzleDb | null = null;
	private _defaults: Record<string, Record<string, unknown>> = {};

	setDefaults(defaults: Record<string, Record<string, unknown>>): void {
		this._defaults = structuredClone(defaults);
	}

	async getEffectiveParam(name: DbConfigParamName): Promise<Record<string, unknown>> {
		return { ...this._defaults[name], ...(await this.getParam(name)) };
	}

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
		const rows = await runtimeConfigCacheFor(this._db).configRows();
		const value = rows.find((row) => row.param_name === paramName)?.param_value;
		return typeof value === "object" && value !== null && !Array.isArray(value) ? structuredClone(value as Record<string, unknown>) : {};
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
