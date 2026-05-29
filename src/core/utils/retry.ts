/**
 * 重试机制 — 指数退避 + 最大重试次数限制
 */

/** 重试选项 */
export interface RetryOptions {
	/** 最大重试次数（默认 3） */
	readonly maxRetries?: number;
	/** 初始延迟（毫秒，默认 1000） */
	readonly delayMs?: number;
	/** 退避乘数（默认 2） */
	readonly backoffMultiplier?: number;
}

/** 默认重试选项 */
const DEFAULT_OPTIONS: Required<RetryOptions> = {
	maxRetries: 3,
	delayMs: 1000,
	backoffMultiplier: 2,
};

/**
 * 带指数退避的重试执行函数
 * 在每次失败后等待递增的延迟时间后重试，达到最大重试次数后抛出最后一次异常
 * @template T
 * @param fn - 需要重试的异步函数
 * @param options - 重试选项
 * @throws 最后一次重试失败时的原始异常
 */
export async function retry<T>(fn: () => Promise<T>, options?: RetryOptions): Promise<T> {
	const { maxRetries, delayMs, backoffMultiplier } = { ...DEFAULT_OPTIONS, ...options };

	let lastError: unknown;

	for (let attempt = 0; attempt <= maxRetries; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error;

			if (attempt < maxRetries) {
				const delay = delayMs * backoffMultiplier ** attempt;
				await sleep(delay);
			}
		}
	}

	throw lastError;
}

/**
 * Promise 化的延迟函数
 * @param ms - 延迟毫秒数
 */
function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
