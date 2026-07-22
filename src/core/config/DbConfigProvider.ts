/**
 * DB 配置提供者 — 读取 LiteLLM_Config 表的运行时配置覆盖
 *
 * 对齐 Python `proxy_config.get_config()` 的 DB 配置合并语义：
 * WebUI 上的设置修改（store_prompts、logo、callbacks 等）写入 LiteLLM_Config 表，
 * 优先级高于 yaml 配置文件。本提供者按 TTL 缓存整表，后台惰性刷新，
 * 读取路径同步无 await（spend 追踪等热路径不能引入异步）。
 */
import { LiteLLM_Config } from "../../db/schema/config";
import type { DrizzleDb } from "../db/Database";
import { createModuleLogger } from "../utils/logger";

const logger = createModuleLogger("DbConfig");

/** 缓存 TTL：WebUI 设置修改后最多 30s 生效（Python proxy_config 同样周期性刷新） */
const CACHE_TTL_MS = 30_000;

/**
 *
 */
export type DbConfigParamName = "general_settings" | "litellm_settings" | "router_settings" | "environment_variables" | string;

class DbConfigProvider {
	private _db: DrizzleDb | null = null;
	private _cache: Record<string, unknown> = {};
	private _cacheLoadedAt = 0;
	private _refreshing: Promise<void> | null = null;

	/**
	 * 初始化（启动时调用一次）；加载失败降级为空配置（yaml 行为不受影响）
	 * @param db
	 */
	async initialize(db: DrizzleDb): Promise<void> {
		this._db = db;
		await this._refresh();
	}

	/**
	 * 立即刷新缓存（写路径落库后调用，避免读取方等待 TTL 过期）。
	 * 与后台惰性刷新共用 _refreshing 去重语义：此处直接 await 完成后再返回。
	 */
	async refreshNow(): Promise<void> {
		await this._refresh();
	}

	/**
	 * 读取 DB 配置参数（同步，命中 TTL 缓存；过期时后台触发刷新并返回旧值）。
	 * @param paramName - LiteLLM_Config.param_name（general_settings / litellm_settings / ...）
	 */
	getParam(paramName: DbConfigParamName): Record<string, unknown> {
		if (this._db && Date.now() - this._cacheLoadedAt > CACHE_TTL_MS) {
			this._refreshInBackground();
		}
		const value = this._cache[paramName];
		return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
	}

	/**
	 * DB 配置是否存在（判断布尔开关时区分"未配置"与"配置为 false"）
	 * @param paramName
	 * @param key
	 */
	hasParam(paramName: DbConfigParamName, key: string): boolean {
		return key in this.getParam(paramName);
	}

	private async _refresh(): Promise<void> {
		if (!this._db) {
			return;
		}
		try {
			const rows = await this._db.select().from(LiteLLM_Config);
			const next: Record<string, unknown> = {};
			for (const row of rows) {
				next[row.param_name] = row.param_value;
			}
			this._cache = next;
			this._cacheLoadedAt = Date.now();
			logger.info("DB 配置已加载", { params: Object.keys(next) });
		} catch (error) {
			// LiteLLM_Config 表不存在（全新部署）或查询失败：保持旧缓存/空配置
			logger.warn("DB 配置加载失败，使用既有缓存", { error: error instanceof Error ? error.message : String(error) });
			this._cacheLoadedAt = Date.now();
		}
	}

	private _refreshInBackground(): void {
		if (this._refreshing) {
			return;
		}
		this._refreshing = this._refresh().finally(() => {
			this._refreshing = null;
		});
	}
}

/** 全局单例（容器初始化时注入 DB） */
export const dbConfigProvider = new DbConfigProvider();
