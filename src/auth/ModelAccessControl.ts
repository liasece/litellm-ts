/**
 * ModelAccessControl — 模型访问控制
 *
 * 处理模型别名展开、通配符匹配（"*" 或 "anthropic/*" 模式）
 * 以及访问组查询的入口。
 */

/**
 * 模型访问控制器
 */
export class ModelAccessControl {
	/**
	 * 判断请求的模型是否在允许列表中
	 *
	 * 匹配规则（按优先级）：
	 * 1. 通配符 "*" — 允许所有模型
	 * 2. 模型别名展开 — 若 requestedModel 在 teamModelAliases 中，替换为目标模型名再检查
	 * 3. 前缀通配符 "anthropic/*" — 匹配前缀
	 * 4. 精确字符串匹配
	 * @param requestedModel - 请求中的模型名（如 "gpt-4"）
	 * @param allowedModels - 允许的模型列表
	 * @param teamModelAliases - 团队模型别名映射（可选）
	 * @returns true 若允许访问
	 */
	canAccessModel(requestedModel: string, allowedModels: string[], teamModelAliases?: Record<string, string>): boolean {
		// 空列表意味着无限制
		if (allowedModels.length === 0) {
			return true;
		}

		// 直接通配符检查
		if (allowedModels.includes("*")) {
			return true;
		}

		// 模型别名展开
		const resolvedModel = teamModelAliases?.[requestedModel] ?? requestedModel;

		// 精确匹配（含展开后）
		if (allowedModels.includes(resolvedModel)) {
			return true;
		}

		// 前缀通配符匹配
		for (const pattern of allowedModels) {
			if (pattern.endsWith("/*") && resolvedModel.startsWith(pattern.slice(0, -1))) {
				return true;
			}
		}

		return false;
	}

	/**
	 * 根据访问组 ID 列表解析可用的模型集合
	 * （当前为桩函数，供后续扩展用）
	 * @param accessGroupIds - 访问组 ID 列表
	 * @returns 模型名称列表
	 */
	async resolveAccessGroupModels(accessGroupIds: string[]): Promise<string[]> {
		if (accessGroupIds.length === 0) {
			return [];
		}
		// TODO: 从 LiteLLM_AccessGroupTable 查询组对应的模型列表
		return [];
	}
}
