/**
 * TPM/RPM Rate Limiter
 *
 * In-memory sliding window rate limiter per deployment.
 * Tracks token counts and request counts over a 60-second window.
 * 对齐 PY lowest_tpm_rpm_v2 行为：基于 current_minute 桶分分钟窗口。
 * 提供 simpleLock 包裹的 increment 方法，对齐 PY Redis INCR 原子操作。
 */

/** Window size in milliseconds (60s 滑动窗口) */
const WINDOW_MS = 60_000;

/** Per-deployment usage data */
interface DeploymentUsage {
	/** Timestamps of token count events */
	tokenEvents: Array<{ timestamp: number; count: number }>;
	/** Timestamps of request events */
	requestEvents: number[];
}

/**
 * TPM/RPM Rate Limiter
 *
 * 按部署实例进行内存滑动窗口限流，统计 60 秒窗口内的 token 数和请求数。
 * 内部用 _mutex 串行化并发 increment 调用，对齐 PY Redis INCR 原子行为。
 */
export class TPMRPMLimiter {
	private _usage: Map<string, DeploymentUsage> = new Map();
	/**
	 * 进程内简单互斥锁。对齐 PY Redis INCR 的原子语义：串行化
	 * "get -> +1 -> set" 序列，避免并发 race。
	 * Node.js 单线程事件循环下可近似达成；对跨进程场景 TS 仍有
	 * 限制（与 PY Redis 共享行为不同），需要在架构层保证单写。
	 */
	private _pendingUpdates: Map<string, Promise<void>> = new Map();

	/**
	 * 串行化对同一 deployment 的 increment 操作
	 * @param deploymentName
	 * @param fn
	 */
	private async _atomicUpdate(deploymentName: string, fn: () => void): Promise<void> {
		const prev = this._pendingUpdates.get(deploymentName) ?? Promise.resolve();
		const next = prev.then(fn).catch(() => {
			// swallow errors so the chain doesn't poison subsequent updates
		});
		this._pendingUpdates.set(deploymentName, next);
		await next;
		// cleanup completed entry to avoid unbounded growth
		if (this._pendingUpdates.get(deploymentName) === next) {
			this._pendingUpdates.delete(deploymentName);
		}
	}

	/**
	 * Get a deployment's usage entry, creating if absent
	 * @param deploymentName
	 */
	private _getEntry(deploymentName: string): DeploymentUsage {
		let entry = this._usage.get(deploymentName);
		if (!entry) {
			entry = { tokenEvents: [], requestEvents: [] };
			this._usage.set(deploymentName, entry);
		}
		return entry;
	}

	/**
	 * Prune events outside the sliding window
	 * @param entry
	 */
	private _prune(entry: DeploymentUsage): void {
		const cutoff = Date.now() - WINDOW_MS;

		entry.tokenEvents = entry.tokenEvents.filter((e) => e.timestamp >= cutoff);
		entry.requestEvents = entry.requestEvents.filter((t) => t >= cutoff);
	}

	/**
	 * Check if a request would be within TPM/RPM limits
	 * GAP: PY lowest_tpm_rpm_v2._return_potential_deployments
	 *   - RPM: `rpm_dict[item] + 1 >= _deployment_rpm` (>=)
	 *   - TPM: `item_tpm + input_tokens > _deployment_tpm` (strict >)
	 *   TS 之前 TPM/RPM 都用 `>=`，现按 PY 区分：TPM 严格大于、RPM 大于等于
	 * @param deploymentName - deployment identifier
	 * @param tpmLimit - max tokens per minute (undefined = no limit)
	 * @param rpmLimit - max requests per minute (undefined = no limit)
	 * @returns true if within limits
	 */
	checkLimit(deploymentName: string, tpmLimit?: number, rpmLimit?: number): boolean {
		if (tpmLimit === undefined && rpmLimit === undefined) {
			return true;
		}

		const entry = this._getEntry(deploymentName);
		this._prune(entry);

		if (rpmLimit !== undefined && entry.requestEvents.length >= rpmLimit) {
			return false;
		}

		if (tpmLimit !== undefined) {
			const totalTokens = entry.tokenEvents.reduce((sum, e) => sum + e.count, 0);
			// PY TPM: strict > (lowest_tpm_rpm_v2.py:339-341)
			if (totalTokens > tpmLimit) {
				return false;
			}
		}

		return true;
	}

	/**
	 * 原子地记录 token 用量，对齐 PY Redis INCR。
	 * @param deploymentName - deployment identifier
	 * @param tokenCount - number of tokens used
	 */
	async incrementTokensAtomic(deploymentName: string, tokenCount: number): Promise<void> {
		return this._atomicUpdate(deploymentName, () => {
			const entry = this._getEntry(deploymentName);
			entry.tokenEvents.push({ timestamp: Date.now(), count: tokenCount });
		});
	}

	/**
	 * 原子地记录请求，对齐 PY Redis INCR rpm_key
	 * @param deploymentName - deployment identifier
	 */
	async incrementRequestAtomic(deploymentName: string): Promise<void> {
		return this._atomicUpdate(deploymentName, () => {
			const entry = this._getEntry(deploymentName);
			entry.requestEvents.push(Date.now());
		});
	}

	/**
	 * Record token usage for a deployment
	 * @param deploymentName - deployment identifier
	 * @param tokenCount - number of tokens used
	 */
	incrementTokens(deploymentName: string, tokenCount: number): void {
		const entry = this._getEntry(deploymentName);
		entry.tokenEvents.push({ timestamp: Date.now(), count: tokenCount });
	}

	/**
	 * Record a request for a deployment
	 * @param deploymentName - deployment identifier
	 */
	incrementRequest(deploymentName: string): void {
		const entry = this._getEntry(deploymentName);
		entry.requestEvents.push(Date.now());
	}

	/**
	 * GAP 6 / GAP 9: 原子 check-and-reserve（对齐 PY redis INCR check-then-act）。
	 * PY `LowestTPMLoggingHandler_v2.async_pre_call_check` 通过 `router_cache.async_increment_cache`
	 * (Redis INCR) 原子化 check-then-act，解决并发 race issue #2994。
	 *
	 * TS 实现：通过 `_atomicUpdate` 把 "读 usage + 判定 + 必要时 +1 request slot" 三步
	 * 串行化到同一 promise chain，确保多并发请求不能同时通过检查。
	 * @param deploymentName - deployment identifier
	 * @param tpmLimit - max tokens per minute (undefined = no limit)
	 * @param rpmLimit - max requests per minute (undefined = no limit)
	 * @param estimatedInputTokens - 估算的 input token，用于 TPM projected check
	 * @returns true 当成功 reserve（视为加入 RPM 1 slot），false 当超限或未通过
	 */
	async checkAndReserve(deploymentName: string, tpmLimit?: number, rpmLimit?: number, estimatedInputTokens = 0): Promise<boolean> {
		let reserved = false;
		await this._atomicUpdate(deploymentName, () => {
			const entry = this._getEntry(deploymentName);
			this._prune(entry);
			const rpmCount = entry.requestEvents.length;
			const tpmCount = entry.tokenEvents.reduce((sum, e) => sum + e.count, 0);
			// PY: RPM 用 `rpm + 1 >= limit`（带 1-slot buffer，>=)
			if (rpmLimit !== undefined && rpmCount + 1 >= rpmLimit) {
				return;
			}
			// PY: TPM 用 `item_tpm + input_tokens > limit`（strict >）
			if (tpmLimit !== undefined && tpmCount + estimatedInputTokens > tpmLimit) {
				return;
			}
			// 通过检查：原子地占据 1 个 RPM slot
			entry.requestEvents.push(Date.now());
			reserved = true;
		});
		return reserved;
	}

	/**
	 * GAP 9: 同步 check-and-reserve（节点内原子）。对齐 PY `LowestTPMLoggingHandler_v2.async_pre_call_check`
	 * 在 Redis INCR check-then-act 路径下的 single-node 等价行为。
	 *
	 * 与 `checkAndReserve` 不同：本方法不走 promise chain（同步），适合同步路由策略
	 * (usage-based-routing-v2) 在 pick 阶段调用。Node.js 单线程下读+写在同一 tick 完成，
	 * 因此对单进程并发请求是原子的。多进程部署仍需架构层（如 Redis）保证。
	 * @param deploymentName
	 * @param tpmLimit
	 * @param rpmLimit
	 * @param estimatedInputTokens
	 * @returns true 当成功 reserve 1 个 RPM slot；false 当超限
	 */
	tryReserveSync(deploymentName: string, tpmLimit?: number, rpmLimit?: number, estimatedInputTokens = 0): boolean {
		const entry = this._getEntry(deploymentName);
		this._prune(entry);
		const rpmCount = entry.requestEvents.length;
		const tpmCount = entry.tokenEvents.reduce((sum, e) => sum + e.count, 0);
		// PY: RPM 用 `rpm + 1 >= limit`（带 1-slot buffer）
		if (rpmLimit !== undefined && rpmCount + 1 >= rpmLimit) {
			return false;
		}
		// PY: TPM 用 `item_tpm + input_tokens > limit`（strict >）
		if (tpmLimit !== undefined && tpmCount + estimatedInputTokens > tpmLimit) {
			return false;
		}
		entry.requestEvents.push(Date.now());
		return true;
	}

	/**
	 * DIFF-010: 回滚最近一次 tryReserveSync 占用的 RPM slot。
	 * 对齐 PY `lowest_tpm_rpm_v2.async_pre_call_check` 在 group-level 占用失败时的批量
	 * rollback 语义（Redis INCR/DECR 配对）。
	 *
	 * 用法：当 usage-based-routing-v2 在 group 内对每个 deployment 依次 reserve，
	 * 但发现没有任一 deployment 可成功 reserve 时，需要把已成功 reserve 的 slot 释放，
	 * 避免错误占用整组 RPM slots（PY atomic transaction 行为）。
	 *
	 * 仅释放最近一次（pop 最新时间戳）；多次成功后多次 rollback 应分别调用同等次数。
	 * @param deploymentName
	 * @returns true 当成功释放一个 slot；false 当无 slot 可释放
	 */
	rollbackReservation(deploymentName: string): boolean {
		const entry = this._usage.get(deploymentName);
		if (!entry || entry.requestEvents.length === 0) {
			return false;
		}
		entry.requestEvents.pop();
		return true;
	}

	/**
	 * Reset all counters for a deployment
	 * @param deploymentName - deployment identifier
	 */
	resetCounters(deploymentName: string): void {
		this._usage.delete(deploymentName);
	}

	/**
	 * Get current TPM and RPM usage for a deployment
	 * @param deploymentName - deployment identifier
	 * @returns current usage within the window
	 */
	getUsage(deploymentName: string): {
		tpm: number;
		rpm: number;
	} {
		const entry = this._getEntry(deploymentName);
		this._prune(entry);

		const tpm = entry.tokenEvents.reduce((sum, e) => sum + e.count, 0);
		return { tpm: tpm, rpm: entry.requestEvents.length };
	}

	/**
	 * 批量获取多 deployment 的 usage，对齐 PY Redis MGET
	 * 一次 filter 多个 key 减少锁竞争窗口
	 * @param deploymentNames
	 */
	getUsageBatch(deploymentNames: string[]): Map<string, { tpm: number; rpm: number }> {
		const cutoff = Date.now() - WINDOW_MS;
		const result = new Map<string, { tpm: number; rpm: number }>();
		for (const name of deploymentNames) {
			const entry = this._usage.get(name);
			if (!entry) {
				result.set(name, { tpm: 0, rpm: 0 });
				continue;
			}
			// PY: 不在每次 getUsage 都重新 filter；这里只 prune 一次减少锁竞争
			entry.tokenEvents = entry.tokenEvents.filter((e) => e.timestamp >= cutoff);
			entry.requestEvents = entry.requestEvents.filter((t) => t >= cutoff);
			const tpm = entry.tokenEvents.reduce((sum, e) => sum + e.count, 0);
			result.set(name, { tpm: tpm, rpm: entry.requestEvents.length });
		}
		return result;
	}

	/**
	 * Check if a deployment is within TPM/RPM limits and return whether it passes
	 * GAP: 原名 checkLimitAndThrow 含 "Throw" 但实际仅返回 bool；现重命名为 checkLimitAndReport (更准确)
	 * PY `pre_call_check` 在 RPM 超限时 raise `litellm.RateLimitError`（lowest_tpm_rpm_v2.py:94-111）
	 * TS 不抛错误，仅返回 bool（保留现状但修正命名）
	 * @param deploymentName - deployment identifier
	 * @param tpmLimit - max tokens per minute (undefined = no limit)
	 * @param rpmLimit - max requests per minute (undefined = no limit)
	 * @returns true if within limits (passed), false if rate limited
	 */
	checkLimitAndReport(deploymentName: string, tpmLimit?: number, rpmLimit?: number): boolean {
		if (tpmLimit === undefined && rpmLimit === undefined) {
			return true;
		}
		const usage = this.getUsage(deploymentName);
		// PY: TPM strict >, RPM >=
		if (tpmLimit !== undefined && usage.tpm > tpmLimit) {
			return false;
		}
		if (rpmLimit !== undefined && usage.rpm >= rpmLimit) {
			return false;
		}
		return true;
	}
}
