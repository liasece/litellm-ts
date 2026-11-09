/**
 * 请求级数据库运行时配置。
 *
 * 每个需要 Router 的 HTTP 请求都绑定一份运行时快照（AsyncLocalStorage）。
 * 三张热表（配置、模型部署、凭据）由 `RuntimeConfigCache` 在 repository 层维护副本：
 * 仓库写入成功后同步或失效副本，因此 WebUI 的配置修改对下一个请求立即生效；
 * 快照本身仍按请求重建，保证请求之间互不共享可变状态。
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ApiError } from "../api/ApiError";
import type { DrizzleDb } from "../db/Database";
import { createModuleLogger } from "../utils/logger";
import type { ServiceConfig } from "./index";
import { CredentialRuntimeAccessor } from "../../credentials/CredentialRuntimeAccessor";
import { proxyModelRowToDeployment } from "../../router/ProxyModelDeployment";
import type { Router, RouterRuntimeSnapshot } from "../../router/Router";
import { RoutingStrategyName } from "../../types/router";
import {
	runtimeConfigCacheFor,
	type RuntimeConfigRow,
	type RuntimeCredentialRow,
	type RuntimeModelRow,
} from "../../repositories/RuntimeConfigCache";

const logger = createModuleLogger("DatabaseRuntimeConfig");

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function buildYamlRouterSettings(config: ServiceConfig): Record<string, unknown> {
	const raw = config.routerSettingsRaw ?? {};
	const settings: Record<string, unknown> = {
		routing_strategy: config.routerSettings.routing_strategy ?? RoutingStrategyName.LatencyBasedRouting,
		num_retries: config.routerSettings.num_retries ?? 2,
		fallbacks: config.routerSettings.fallbacks,
		model_group_alias: {
			...config.generalSettings.model_group_alias,
			...config.routerSettings.model_group_alias,
		},
		enable_pre_call_checks: config.routerSettings.enable_pre_call_checks ?? false,
	};
	for (const [key, value] of Object.entries(raw)) {
		if (value !== undefined) {
			settings[key] = structuredClone(value);
		}
	}
	for (const [key, value] of Object.entries({
		allowed_fails: config.routerSettings.allowed_fails,
		cooldown_time: config.routerSettings.cooldown_time,
		max_fallbacks: config.routerSettings.max_fallbacks,
		request_timeout: config.routerSettings.request_timeout,
	})) {
		if (value !== undefined) {
			settings[key] = value;
		}
	}
	return settings;
}

/** 数据库是唯一动态真源的请求级 Router 配置加载器。 */
export class DatabaseRuntimeConfigService {
	private readonly _yamlRouterSettings: Record<string, unknown>;

	constructor(
		private readonly _db: DrizzleDb,
		config: ServiceConfig,
	) {
		this._yamlRouterSettings = buildYamlRouterSettings(config);
	}

	/**
	 * 读取一次完整运行时配置并构造请求级快照。
	 * 三张表来自 repository 层缓存：命中时不产生数据库查询，失效后各装载一次。
	 * @param router - 接收最新部署快照的 Router
	 */
	async loadSnapshot(router: Router): Promise<RouterRuntimeSnapshot> {
		const cache = runtimeConfigCacheFor(this._db);
		const [configRows, modelRows, credentialRows] = await Promise.all([
			cache.configRows(),
			cache.modelRows(),
			cache.credentialRows(),
		]);
		return this._buildSnapshot(router, configRows, modelRows, credentialRows, cache.revision());
	}

	private _buildSnapshot(
		router: Router,
		configRows: RuntimeConfigRow[],
		modelRows: RuntimeModelRow[],
		credentialRows: RuntimeCredentialRow[],
		revision: number,
	): RouterRuntimeSnapshot {
		const configByName = new Map(configRows.map((row) => [row.param_name, row.param_value]));
		const dbGeneralSettings = configByName.get("general_settings");
		const dbRouterSettings = configByName.get("router_settings");
		const effectiveSettings: Record<string, unknown> = structuredClone(this._yamlRouterSettings);

		if (isRecord(dbGeneralSettings) && isRecord(dbGeneralSettings["model_group_alias"])) {
			effectiveSettings["model_group_alias"] = structuredClone(dbGeneralSettings["model_group_alias"]);
		}
		if (isRecord(dbRouterSettings)) {
			for (const [key, value] of Object.entries(dbRouterSettings)) {
				effectiveSettings[key] = structuredClone(value);
			}
		}

		const credentials = new CredentialRuntimeAccessor();
		credentials.replaceAll(
			credentialRows.map((row) => ({
				credential_name: row.credential_name,
				credential_values: isRecord(row.credential_values) ? structuredClone(row.credential_values) : {},
				credential_info: isRecord(row.credential_info) ? structuredClone(row.credential_info) : {},
			})),
		);

		return router.createRuntimeSnapshot(modelRows.map(proxyModelRowToDeployment), effectiveSettings, credentials, revision);
	}

	/**
	 * Express 中间件：装载失败时 fail closed，绝不回退到旧内存配置。
	 * 同一请求经过多条带该中间件的路由链时复用已绑定的快照，避免重复重建。
	 * @param router
	 */
	middleware(router: Router): RequestHandler {
		return async (_req: Request, _res: Response, next: NextFunction): Promise<void> => {
			try {
				const existing = router.currentRuntimeSnapshot();
				if (existing !== undefined && existing.configRevision === runtimeConfigCacheFor(this._db).revision()) {
					next();
					return;
				}
				const snapshot = await this.loadSnapshot(router);
				router.runWithRuntimeSnapshot(snapshot, next);
			} catch (error) {
				logger.error("请求级数据库运行时配置加载失败", {
					error: error instanceof Error ? error.message : String(error),
				});
				next(ApiError.unavailable("Runtime configuration database query failed"));
			}
		};
	}
}
