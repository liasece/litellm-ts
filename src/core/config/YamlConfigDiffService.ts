/**
 * yaml 配置差异检测服务
 *
 * 配置全面迁移到「网页设置 + 数据库存储」后，yaml 文件仍是启动基线。
 * 本服务在启动时（container 初始化 dbConfigProvider 之后）比较当前 yaml
 * 与 LiteLLM_Config 中存储的上次 yaml 快照（param_name = config_yaml_snapshot）：
 *
 * - 快照 hash 与当前 yaml 规范化 JSON 的 sha256 一致 → 无差异；
 * - 无快照（首次运行）且 DB 四设置段 + 模型表全空 → 直接存快照，无 pending；
 * - 否则全量 diff，差异项存内存 pending 列表，由 WebUI 差异对比窗口
 *   逐项接受（/config/yaml_diff/accept）或整体完成（/config/yaml_diff/resolve）。
 *
 * diff 粒度：
 * - general_settings / litellm_settings / router_settings / environment_variables
 *   四段按顶层字段级：yaml 值 vs DB 值，深比较相等则跳过；
 * - model_list 按 model_name 逐模型：yaml 有 DB 无 → db_missing；两侧都有但
 *   litellm_params/model_info 不同 → params_differ；DB 有 yaml 无不列为冲突
 *   （那是网页新增的模型，DB 优先语义下合法）。
 */
import * as crypto from "node:crypto";
import { LiteLLM_ProxyModelTable } from "../../db/schema/proxyModels";
import { ConfigRepository } from "../../repositories/ConfigRepository";
import type { DrizzleDb } from "../db/Database";
import { createModuleLogger } from "../utils/logger";
import { getRawYamlConfig } from "./index";
import type { ProxyModelRowLike } from "../../router/ProxyModelDeployment";

const logger = createModuleLogger("YamlConfigDiff");

/** 存储 yaml 快照的 LiteLLM_Config param_name（Python 只认 4 个固定 key，不会误读） */
export const CONFIG_YAML_SNAPSHOT_PARAM = "config_yaml_snapshot";

/** 参与 diff 的四个设置段 */
export const YAML_DIFF_SETTING_SECTIONS = ["general_settings", "litellm_settings", "router_settings", "environment_variables"] as const;

/**
 *
 */
export type YamlDiffSettingSection = (typeof YAML_DIFF_SETTING_SECTIONS)[number];
/**
 *
 */
export type YamlDiffSection = YamlDiffSettingSection | "model_list";

/**
 * 差异类型：
 * - db_missing：yaml 有、DB 无（设置字段缺失或模型未入库）
 * - value_differs：设置字段两侧都有但值不同
 * - params_differ：模型两侧都有但 litellm_params/model_info 不同
 */
export type YamlDiffKind = "db_missing" | "value_differs" | "params_differ";

/**
 *
 */
export interface YamlConfigDiffItem {
	/**
	 *
	 */
	readonly section: YamlDiffSection;
	/** 设置段为顶层字段名；model_list 为 model_name */
	readonly key: string;
	/**
	 *
	 */
	readonly yaml_value: unknown;
	/**
	 *
	 */
	readonly db_value: unknown;
	/**
	 *
	 */
	readonly diff_kind: YamlDiffKind;
}

/** config_yaml_snapshot param_value 形状 */
export interface YamlConfigSnapshot {
	/**
	 *
	 */
	readonly hash: string;
	/**
	 *
	 */
	readonly content: string;
	/**
	 *
	 */
	readonly updated_at: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 规范化 JSON：递归按对象键排序序列化，保证同语义对象（键序不同）得到相同字符串，
 * 用作 sha256 输入与深比较判等依据。
 * @param value - 任意 JSON 兼容值
 */
export function canonicalizeConfigValue(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map((item) => canonicalizeConfigValue(item)).join(",")}]`;
	}
	if (isRecord(value)) {
		const entries = Object.keys(value)
			.sort()
			.filter((key) => value[key] !== undefined)
			.map((key) => `${JSON.stringify(key)}:${canonicalizeConfigValue(value[key])}`);
		return `{${entries.join(",")}}`;
	}
	return JSON.stringify(value) ?? "null";
}

/**
 * 深比较（键序无关）
 * @param a
 * @param b
 */
function deepEqualConfigValue(a: unknown, b: unknown): boolean {
	return canonicalizeConfigValue(a) === canonicalizeConfigValue(b);
}

/** 当前 yaml 的规范化 JSON 与 sha256；未加载 yaml 时返回 null */
export function computeCurrentYamlSnapshot(): { readonly hash: string; readonly content: string } | null {
	const rawEntry = getRawYamlConfig();
	if (!rawEntry || !isRecord(rawEntry.raw)) {
		return null;
	}
	const content = canonicalizeConfigValue(rawEntry.raw);
	const hash = crypto.createHash("sha256").update(content, "utf8").digest("hex");
	return { hash: hash, content: content };
}

/** DB 模型 model_info 注入字段（id/db_model 由存储层生成，不参与 yaml 对比） */
const DB_MODEL_INFO_INJECTED_KEYS: ReadonlySet<string> = new Set(["id", "db_model"]);

function stripInjectedModelInfo(modelInfo: unknown): Record<string, unknown> {
	if (!isRecord(modelInfo)) {
		return {};
	}
	const stripped: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(modelInfo)) {
		if (!DB_MODEL_INFO_INJECTED_KEYS.has(key)) {
			stripped[key] = value;
		}
	}
	return stripped;
}

/**
 * 计算 yaml 与 DB 的全量差异项（纯函数，供启动检测与单测复用）。
 * @param rawYaml - js-yaml 原始解析对象
 * @param dbSections - 四设置段的 DB 值（param_value，缺失段传 {}）
 * @param dbModels - LiteLLM_ProxyModelTable 全量行
 */
export function computeYamlConfigDiff(
	rawYaml: Record<string, unknown>,
	dbSections: Record<YamlDiffSettingSection, Record<string, unknown>>,
	dbModels: readonly ProxyModelRowLike[],
): YamlConfigDiffItem[] {
	const items: YamlConfigDiffItem[] = [];

	for (const section of YAML_DIFF_SETTING_SECTIONS) {
		const yamlSection = rawYaml[section];
		if (!isRecord(yamlSection)) {
			continue;
		}
		const dbSection = dbSections[section];
		for (const [key, yamlValue] of Object.entries(yamlSection)) {
			if (!(key in dbSection)) {
				items.push({ section: section, key: key, yaml_value: yamlValue, db_value: null, diff_kind: "db_missing" });
			} else if (!deepEqualConfigValue(yamlValue, dbSection[key])) {
				items.push({ section: section, key: key, yaml_value: yamlValue, db_value: dbSection[key], diff_kind: "value_differs" });
			}
		}
	}

	const yamlModelList = rawYaml["model_list"];
	if (Array.isArray(yamlModelList)) {
		for (const yamlModel of yamlModelList) {
			if (!isRecord(yamlModel) || typeof yamlModel["model_name"] !== "string") {
				continue;
			}
			const modelName = yamlModel["model_name"];
			const dbModel = dbModels.find((row) => row.model_name === modelName);
			if (!dbModel) {
				items.push({ section: "model_list", key: modelName, yaml_value: yamlModel, db_value: null, diff_kind: "db_missing" });
				continue;
			}
			const paramsDiffer = !deepEqualConfigValue(yamlModel["litellm_params"] ?? {}, dbModel.litellm_params ?? {});
			const infoDiffer = !deepEqualConfigValue(
				stripInjectedModelInfo(yamlModel["model_info"]),
				stripInjectedModelInfo(dbModel.model_info),
			);
			if (paramsDiffer || infoDiffer) {
				items.push({
					section: "model_list",
					key: modelName,
					yaml_value: yamlModel,
					db_value: {
						model_id: dbModel.model_id,
						litellm_params: dbModel.litellm_params ?? {},
						model_info: dbModel.model_info ?? {},
					},
					diff_kind: "params_differ",
				});
			}
		}
	}

	return items;
}

/**
 * yaml 差异检测单例：启动时初始化 pending 列表，供 /config/yaml_diff 端点读写。
 */
export class YamlConfigDiffService {
	private _pending: YamlConfigDiffItem[] = [];

	/**
	 * 启动检测（container 在 dbConfigProvider.initialize 之后调用一次）。
	 * 比对 yaml 快照 hash；不一致或无快照时按规则生成 pending 差异项。
	 * 失败不阻断启动（降级为无 pending）。
	 * @param db - Drizzle 数据库实例
	 */
	async initialize(db: DrizzleDb): Promise<void> {
		this._pending = [];
		try {
			const current = computeCurrentYamlSnapshot();
			if (!current) {
				return;
			}
			const configRepository = new ConfigRepository(db);
			const snapshot = await configRepository.getParam(CONFIG_YAML_SNAPSHOT_PARAM);
			const snapshotHash = typeof snapshot?.["hash"] === "string" ? snapshot["hash"] : null;
			if (snapshotHash !== null && snapshotHash === current.hash) {
				return;
			}

			const dbSections = {} as Record<YamlDiffSettingSection, Record<string, unknown>>;
			for (const section of YAML_DIFF_SETTING_SECTIONS) {
				dbSections[section] = (await configRepository.getParam(section)) ?? {};
			}
			let dbModels: ProxyModelRowLike[] = [];
			try {
				dbModels = await db.select().from(LiteLLM_ProxyModelTable);
			} catch {
				// LiteLLM_ProxyModelTable 不存在（全新部署）：视为空表
			}

			// 首次运行（无快照）且 DB 全空：直接存快照，无 pending
			if (snapshotHash === null) {
				const dbEmpty =
					YAML_DIFF_SETTING_SECTIONS.every((section) => Object.keys(dbSections[section]).length === 0) && dbModels.length === 0;
				if (dbEmpty) {
					await this._storeSnapshot(configRepository, current.hash, current.content);
					logger.info("yaml 配置快照已初始化（首次运行，DB 为空）");
					return;
				}
			}

			const rawEntry = getRawYamlConfig();
			if (!rawEntry || !isRecord(rawEntry.raw)) {
				return;
			}
			this._pending = computeYamlConfigDiff(rawEntry.raw, dbSections, dbModels);
			if (this._pending.length > 0) {
				logger.info("检测到 yaml 与 DB 配置差异", { pendingItems: this._pending.length });
			}
		} catch (error) {
			// 差异检测失败不阻断启动
			this._pending = [];
			logger.warn("yaml 配置差异检测失败，跳过", { error: error instanceof Error ? error.message : String(error) });
		}
	}

	/** 当前 pending 差异项（只读拷贝） */
	getPendingItems(): readonly YamlConfigDiffItem[] {
		return [...this._pending];
	}

	/**
	 *
	 */
	hasPending(): boolean {
		return this._pending.length > 0;
	}

	/**
	 * 按段+键查找 pending 项（accept 端点取 yaml_value 用）
	 * @param section
	 * @param key
	 */
	findPendingItem(section: YamlDiffSection, key: string): YamlConfigDiffItem | null {
		return this._pending.find((item) => item.section === section && item.key === key) ?? null;
	}

	/**
	 * accept 后从 pending 列表移除该项
	 * @param section
	 * @param key
	 */
	removePendingItem(section: YamlDiffSection, key: string): boolean {
		const index = this._pending.findIndex((item) => item.section === section && item.key === key);
		if (index < 0) {
			return false;
		}
		this._pending.splice(index, 1);
		return true;
	}

	/**
	 * 「处理冲突完成」：将当前 yaml 快照 {hash, content, updated_at} upsert 到
	 * config_yaml_snapshot 并清空 pending。
	 * @param db - Drizzle 数据库实例
	 * @returns 写入的快照；当前无 yaml 加载时返回 null
	 */
	async resolveSnapshot(db: DrizzleDb): Promise<YamlConfigSnapshot | null> {
		const current = computeCurrentYamlSnapshot();
		if (!current) {
			return null;
		}
		const configRepository = new ConfigRepository(db);
		const snapshot = await this._storeSnapshot(configRepository, current.hash, current.content);
		this._pending = [];
		return snapshot;
	}

	private async _storeSnapshot(configRepository: ConfigRepository, hash: string, content: string): Promise<YamlConfigSnapshot> {
		const snapshot: YamlConfigSnapshot = { hash: hash, content: content, updated_at: new Date().toISOString() };
		await configRepository.upsertParam(CONFIG_YAML_SNAPSHOT_PARAM, snapshot);
		return snapshot;
	}
}

/** 全局单例（container 启动时初始化） */
export const yamlConfigDiffService = new YamlConfigDiffService();
