/**
 * 响应出口内部字段剥离
 *
 * Router/Provider 会在响应对象顶层挂载 `_` 前缀的内部字段
 * （如 _provider/_fallbackDepth/_providerHeaders/_customCostPerToken/_hidden_params），
 * 供端点内部消费（spend 追踪、响应头透传、model 改写判定）。
 * OpenAI/Anthropic 协议顶层均无 `_` 前缀的合法字段（Python litellm 同样不输出内部字段），
 * 因此在响应序列化出口统一剥离，避免内部实现细节泄漏给客户端。
 */

/**
 * 剥离响应数据顶层的 `_` 前缀内部字段
 *
 * 仅剥离顶层键；嵌套对象（如 usage、message）不属于内部字段挂载点，保持原样。
 * @param result - 路由处理器返回的响应数据
 * @returns 无内部字段的响应对象；非普通对象（null/数组/原始值）或无内部字段时原样返回（零拷贝）
 */
export function stripInternalFields(result: unknown): unknown {
	if (result === null || typeof result !== "object" || Array.isArray(result)) {
		return result;
	}
	const source = result as Record<string, unknown>;
	const keys = Object.keys(source);
	if (!keys.some((key) => key.startsWith("_"))) {
		return result;
	}
	const cleaned: Record<string, unknown> = {};
	for (const key of keys) {
		if (!key.startsWith("_")) {
			cleaned[key] = source[key];
		}
	}
	return cleaned;
}
