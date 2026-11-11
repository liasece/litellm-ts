/**
 * 同一账号刷新请求的进程内去重。
 *
 * 文件锁只能保证写入串行；没有单飞时，并发请求会排队后各自再 POST 一次，
 * 对 refresh token 轮换的 Provider 会造成后一次使用已作废 token。
 */

/**
 * 把同 key 的异步任务合并为一次执行。
 * @template T - 任务结果类型
 * @param map - 任务表
 * @param key - 去重键
 * @param task - 实际任务
 */
export function singleFlight<T>(map: Map<string, Promise<T>>, key: string, task: () => Promise<T>): Promise<T> {
	const existing = map.get(key);
	if (existing) {
		return existing;
	}
	const running = task().finally(() => {
		if (map.get(key) === running) {
			map.delete(key);
		}
	});
	map.set(key, running);
	return running;
}
