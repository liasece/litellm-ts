/**
 * 请求级数据库运行时配置。
 *
 * 每个需要 Router 的 HTTP 请求都在只读、可重复读事务中读取配置、模型和凭据，
 * 然后通过 AsyncLocalStorage 绑定到该请求。这里没有跨请求 TTL 或进程级配置缓存。
 */
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ApiError } from "../api/ApiError";
import type { DrizzleDb } from "../db/Database";
import { createModuleLogger } from "../utils/logger";
import type { ServiceConfig } from "./index";
import { LiteLLM_Config } from "../../db/schema/config";
import { LiteLLM_CredentialsTable } from "../../db/schema/credentials";
import { LiteLLM_ProxyModelTable } from "../../db/schema/proxyModels";
import { CredentialRuntimeAccessor } from "../../credentials/CredentialRuntimeAccessor";
import { proxyModelRowToDeployment } from "../../router/ProxyModelDeployment";
import type { Router, RouterRuntimeSnapshot } from "../../router/Router";
import { RoutingStrategyName } from "../../types/router";

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

	/** 在一致的数据库快照中读取一次完整运行时配置。 */
	async loadSnapshot(router: Router): Promise<RouterRuntimeSnapshot> {
		const result = await this._db.transaction(
			async (tx) => {
				const configRows = await tx.select().from(LiteLLM_Config);
				const modelRows = await tx.select().from(LiteLLM_ProxyModelTable);
				const credentialRows = await tx.select().from(LiteLLM_CredentialsTable);
				return { configRows: configRows, modelRows: modelRows, credentialRows: credentialRows };
			},
			{ isolationLevel: "repeatable read", accessMode: "read only" },
		);

		const configByName = new Map(result.configRows.map((row) => [row.param_name, row.param_value]));
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
			result.credentialRows.map((row) => ({
				credential_name: row.credential_name,
				credential_values: isRecord(row.credential_values) ? structuredClone(row.credential_values) : {},
				credential_info: isRecord(row.credential_info) ? structuredClone(row.credential_info) : {},
			})),
		);

		return router.createRuntimeSnapshot(result.modelRows.map(proxyModelRowToDeployment), effectiveSettings, credentials);
	}

	/**
	 * Express 中间件：查询失败时 fail closed，绝不回退到旧内存配置。
	 * @param router
	 */
	middleware(router: Router): RequestHandler {
		return async (_req: Request, _res: Response, next: NextFunction): Promise<void> => {
			try {
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
