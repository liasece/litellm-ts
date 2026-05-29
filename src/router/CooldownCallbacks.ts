/**
 * CooldownCallbacks — 冷却事件回调签名 + 列表类型
 *
 * 抽离自 CooldownManager，消除以下重复：
 *   - 字段声明中的 inline 数组类型（避免 5+ 参数长签名内联）
 *   - constructor / addCooldownCallback 的重复参数类型
 *
 * 对齐 PY `router.cooldown_callbacks: List[CooldownEventCallback]`。
 */

/**
 * 冷却事件回调签名。
 * 同步回调直接返回 `void`；异步回调返回 `Promise<void>`，主路径走 fire-and-forget。
 */
export type CooldownCallback = (
	deploymentId: string,
	cooldownDurationMs: number,
	statusCode: number,
	exceptionReceived: string,
) => void | Promise<void>;
