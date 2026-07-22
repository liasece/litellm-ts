/**
 * LiteLLM_ProxyModelTable 行 → Router Deployment 转换
 *
 * 对齐 Python `get_model_info_with_id(db_model=True)`（proxy_server.py:3584-3620）：
 * DB 加载的模型 model_info 强制写入 `id`（= model_id）与 `db_model: true`，
 * 供 UI 区分「DB 模型」与「yaml 配置模型」。container 启动回灌与
 * /model/new|update 热更新共用此转换，保证两条路径产出的 Deployment 一致。
 */

import type { Deployment, LitellmParams } from "../types/router";
import type { ModelInfo } from "../types/config";

/** LiteLLM_ProxyModelTable 行的最小结构（与 drizzle schema 解耦，便于测试与复用） */
export interface ProxyModelRowLike {
	/**
	 *
	 */
	readonly model_id: string;
	/**
	 *
	 */
	readonly model_name: string;
	/**
	 *
	 */
	readonly litellm_params: unknown;
	/**
	 *
	 */
	readonly model_info: unknown;
}

/**
 * DB 模型行转 Router Deployment。
 * @param row - LiteLLM_ProxyModelTable 行
 */
export function proxyModelRowToDeployment(row: ProxyModelRowLike): Deployment {
	const rowModelInfo = typeof row.model_info === "object" && row.model_info !== null ? (row.model_info as Record<string, unknown>) : {};
	return {
		model_name: row.model_name,
		litellm_params: row.litellm_params as LitellmParams,
		model_info: { ...rowModelInfo, id: row.model_id, db_model: true } as unknown as ModelInfo,
	};
}
