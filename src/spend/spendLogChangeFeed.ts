/**
 * 日志列表变化通知总线（进程内）。
 *
 * 日志页的 Live Tail 不再由每个浏览器定时拉取整页列表，而是由 WebSocket 只推送
 * 「有变化」这一事实，收到后再用完整日志接口取数据。变化来源是写入路径本身：
 * 在途请求注册、checkpoint 补写、请求结束落账与孤儿回收都会发布一次通知。
 *
 * 通知只是提示，不携带日志内容；监听者抛错也不能反过来影响计费与落账，因此这里
 * 吞掉监听异常。多实例或跨进程写入不会经过本总线，由客户端按 Live Tail 间隔的
 * 兜底拉取覆盖。
 */

/** 日志列表可能已变化的通知回调。 */
export type SpendLogChangeListener = () => void;

const listeners = new Set<SpendLogChangeListener>();

/**
 * 订阅日志列表变化通知。
 * @param listener - 收到通知时调用；应尽快返回，不要在其中做重查询
 * @returns 取消订阅函数
 */
export function subscribeSpendLogChanges(listener: SpendLogChangeListener): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/**
 * 发布一次「日志列表可能已变化」通知。
 *
 * 调用方应只在写入成功后调用；同一批写入可以重复发布，接收端会合并。
 */
export function publishSpendLogChange(): void {
	for (const listener of [...listeners]) {
		try {
			listener();
		} catch {
			// 通知观察者失败不能影响写入路径。
		}
	}
}
