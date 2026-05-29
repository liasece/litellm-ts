/**
 * RouterModelGroupCache — 模型组 → deployment 列表缓存
 *
 * 抽离 Router 中模型组缓存相关方法：
 *   - _getModelGroupName（解析 deployment 的模型组名）
 *   - _getModelGroupCache（lazy 构建缓存）
 *   - _invalidateModelGroupCache（部署变更时失效）
 *   - _countSameGroupDeployments（同组部署数）
 *
 * 对齐 PY `Router.get_model_group_info` 的 LRU 缓存策略。
 */

import type { Deployment } from "../types/router";

/**
 * 解析 deployment 的模型组名。
 * 优先级：model_info.metadata.model_group_name > model_info.model_name > model_name
 * @param deployment
 */
export function getModelGroupName(deployment: Deployment): string {
	const metaGroupName = (deployment.model_info?.metadata as Record<string, unknown> | undefined)?.["model_group_name"];
	if (typeof metaGroupName === "string" && metaGroupName.length > 0) {
		return metaGroupName;
	}
	return deployment.model_info?.model_name ?? deployment.model_name;
}

/**
 * 解析 deployment 的稳定 key。
 * 对齐 PY uses model_info.id only（无 fallback）。
 * @param deployment
 */
export function getDeploymentKey(deployment: Deployment): string {
	return deployment.model_info?.id ?? deployment.model_name;
}

/**
 * 模型组缓存持有者 — 提供 lazy 缓存 + 失效 + 同组计数。
 */
export class ModelGroupCache {
	private _cache: Map<string, string[]> | undefined;

	/**
	 * 失效缓存。_deployments 变更时必须调用。
	 */
	invalidate(): void {
		this._cache = undefined;
	}

	/**
	 * 返回 model_group → deployment_ids 缓存。lazy 构建。
	 * @param deployments - 当前所有部署
	 * @param groupNameOf - 给定 deployment 解析组名
	 */
	getCache(deployments: Deployment[], groupNameOf: (d: Deployment) => string): Map<string, string[]> {
		if (this._cache) {
			return this._cache;
		}
		const cache = new Map<string, string[]>();
		for (const dep of deployments) {
			const groupName = groupNameOf(dep);
			const ids = cache.get(groupName) ?? [];
			ids.push(getDeploymentKey(dep));
			cache.set(groupName, ids);
		}
		this._cache = cache;
		return cache;
	}

	/**
	 * 计算同模型组的部署实例数（含自身）。
	 * @param deployment
	 * @param deployments
	 */
	countSameGroup(deployment: Deployment, deployments: Deployment[]): number {
		const targetGroup = getModelGroupName(deployment);
		return this.getCache(deployments, getModelGroupName).get(targetGroup)?.length ?? 0;
	}
}
