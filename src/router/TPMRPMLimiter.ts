/**
 * TPM/RPM Rate Limiter
 *
 * In-memory sliding window rate limiter per deployment.
 * Tracks token counts and request counts over a 60-second window.
 */

/** Window size in milliseconds */
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
 */
export class TPMRPMLimiter {
	private _usage: Map<string, DeploymentUsage> = new Map();

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
			if (totalTokens >= tpmLimit) {
				return false;
			}
		}

		return true;
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
	 * Check if a deployment is within TPM/RPM limits and return whether it passes
	 * @param deploymentName - deployment identifier
	 * @param tpmLimit - max tokens per minute (undefined = no limit)
	 * @param rpmLimit - max requests per minute (undefined = no limit)
	 * @returns true if within limits (passed), false if rate limited
	 */
	checkLimitAndThrow(deploymentName: string, tpmLimit?: number, rpmLimit?: number): boolean {
		if (tpmLimit === undefined && rpmLimit === undefined) {
			return true;
		}
		const usage = this.getUsage(deploymentName);
		if (tpmLimit !== undefined && usage.tpm >= tpmLimit) {
			return false;
		}
		if (rpmLimit !== undefined && usage.rpm >= rpmLimit) {
			return false;
		}
		return true;
	}
}
