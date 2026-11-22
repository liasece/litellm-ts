/**
 * 订阅账号调度。
 *
 * 默认行为对齐旧运行时的 `session-affinity: true` + 轮询 + 关闭冷却：
 * 同一会话优先复用上次账号，否则按权重平滑轮询。凭据过期不在这里过滤，
 * 由鉴权层在发送前刷新；只有显式禁用/归档的账号不参与调度。
 */

import { ApiError } from "../../core/api/ApiError";
import type { SubscriptionAccount, SubscriptionSource } from "./types";

/** 调度器选项。 */
export interface SubscriptionAccountSchedulerOptions {
	/** 会话亲和有效期（毫秒）；<=0 关闭亲和。 */
	readonly affinityTtlMs?: number;
	/** 会话亲和缓存上限。 */
	readonly maxAffinityEntries?: number;
	/** 候选账号加载器；提供后可直接使用 pick。 */
	readonly loadAccounts?: (source: SubscriptionSource) => Promise<readonly SubscriptionAccount[]>;
}

/** 一次调度结果。 */
export interface SubscriptionAccountSelection {
	/** 选中账号。 */
	readonly account: SubscriptionAccount;
	/** 是否命中会话亲和。 */
	readonly affinity: boolean;
}

/** 会话亲和记录。 */
interface AffinityEntry {
	readonly accountId: string;
	expiresAt: number;
}

/** 平滑加权轮询的当前权重。 */
interface WeightedState {
	readonly current: Map<string, number>;
}

/**
 * 该状态码的失败是否只能按账号归属。
 *
 * 凭证/付费主体失效换模型也不会好，只能整账号避开；其余（限流、超时、5xx）
 * 只说明「这个账号上的这个模型此刻不行」。
 * @param status - 上游状态码
 */
function isAccountScopedFailure(status: number): boolean {
	return status === 401 || status === 402 || status === 403;
}

/**
 * 按来源维护调度状态。
 */
export class SubscriptionAccountScheduler {
	private readonly _affinityTtlMs: number;
	private readonly _maxAffinityEntries: number;
	private readonly _affinity = new Map<string, AffinityEntry>();
	private readonly _weighted = new Map<SubscriptionSource, WeightedState>();
	private readonly _cooldown = new Map<string, { until: number; reason: string }>();
	private readonly _loadAccounts?: (source: SubscriptionSource) => Promise<readonly SubscriptionAccount[]>;

	constructor(options: SubscriptionAccountSchedulerOptions = {}) {
		this._affinityTtlMs = options.affinityTtlMs ?? 60 * 60 * 1000;
		this._maxAffinityEntries = options.maxAffinityEntries ?? 10_000;
		this._loadAccounts = options.loadAccounts;
	}

	/**
	 * 选出一个账号；使用构造时注入的候选加载器。
	 * @param source - 账号来源
	 * @param sessionKey - 会话键；空串关闭亲和
	 * @param exclude - 本次请求已失败、需要排除的账号 ID
	 * @param model - 上游模型名；提供后只受该模型的冷却窗口影响，见 markFailure 的粒度说明
	 * @throws {ApiError} 调度器未配置加载器或没有可用账号时抛出
	 */
	async pick(
		source: SubscriptionSource,
		sessionKey: string,
		exclude?: ReadonlySet<string>,
		model?: string,
	): Promise<SubscriptionAccountSelection> {
		if (!this._loadAccounts) {
			throw ApiError.unavailable("调度器未配置账号加载器");
		}
		const candidates = await this._loadAccounts(source);
		return this.select(source, sessionKey, candidates, exclude, model);
	}

	/**
	 * 从给定候选集中选出账号；候选为空时抛 503。
	 * @param source - 账号来源
	 * @param sessionKey - 会话键
	 * @param candidates - 候选账号
	 * @param exclude - 排除账号
	 * @param model - 上游模型名；提供后额外考虑该模型自己的冷却窗口
	 * @throws {ApiError} 候选为空时抛出
	 */
	select(
		source: SubscriptionSource,
		sessionKey: string,
		candidates: readonly SubscriptionAccount[],
		exclude?: ReadonlySet<string>,
		model?: string,
	): SubscriptionAccountSelection {
		const now = Date.now();
		// 账号级冷却（凭证失效、额度耗尽）与模型级冷却（该模型被上游限流/5xx）取较大者：
		// 前者说明整个账号不可用，后者只说明这个模型暂时不可用。
		const coolingUntil = (accountId: string): number =>
			Math.max(
				this._cooldown.get(this._cooldownKey(source, accountId))?.until ?? 0,
				model ? (this._cooldown.get(this._modelCooldownKey(source, accountId, model))?.until ?? 0) : 0,
			);
		const available = candidates.filter(
			(account) => !account.disabled && account.weight > 0 && !exclude?.has(account.id) && coolingUntil(account.id) <= now,
		);
		if (available.length === 0) {
			const cooling = candidates.filter((account) => coolingUntil(account.id) > now);
			if (cooling.length > 0) {
				// 冷却原因（含上游状态码与错误摘要）一并回显：否则调用方只看到「稍后重试」，
				// 无法知道是限流、超时还是凭证失效。
				const reasons = [
					...new Set(
						cooling
							.map(
								(candidate) =>
									this._cooldown.get(this._cooldownKey(source, candidate.id))?.reason ??
									(model ? this._cooldown.get(this._modelCooldownKey(source, candidate.id, model))?.reason : undefined),
							)
							.filter((reason): reason is string => typeof reason === "string" && reason.length > 0),
					),
				];
				const suffix = reasons.length > 0 ? `（最近失败：${reasons.join("；")}）` : "";
				throw ApiError.tooManyRequests(
					(model
						? `所有 ${source} 订阅账号在该模型（${model}）上都处于冷却中，请稍后重试`
						: `所有 ${source} 订阅账号都在冷却中，请稍后重试`) + suffix,
				);
			}
			throw ApiError.unavailable(`没有可用的 ${source} 订阅账号`);
		}
		// 先按 priority 分层，只在最小数值的层内做加权轮询；高层账号作为故障后备。
		const priority = Math.min(...available.map((account) => account.priority ?? 0));
		const tier = available.filter((account) => (account.priority ?? 0) === priority);
		if (sessionKey && this._affinityTtlMs > 0) {
			const entry = this._affinity.get(this._key(source, sessionKey));
			if (entry && entry.expiresAt > now) {
				const matched = tier.find((account) => account.id === entry.accountId);
				if (matched) {
					return { account: matched, affinity: true };
				}
			}
		}
		const account = this._weightedPick(source, tier);
		if (sessionKey && this._affinityTtlMs > 0) {
			this._remember(source, sessionKey, account.id);
		}
		return { account: account, affinity: false };
	}

	/**
	 * 清除会话亲和，强制下一次重新调度。
	 * @param source - 账号来源
	 * @param sessionKey - 会话键
	 */
	forget(source: SubscriptionSource, sessionKey: string): void {
		this._affinity.delete(this._key(source, sessionKey));
	}

	/**
	 * 记录账号失败并按状态设置冷却窗口。
	 *
	 * 冷却按「谁被上游拒绝」的粒度归属，而不是一律按账号：
	 *   - 401/402/403 是凭证或付费主体失效，换模型也一样失败 → 账号级冷却；
	 *   - 408/429/5xx 通常是某个模型在该账号上的限流或瞬时故障 → 模型级冷却。
	 *
	 * 生产上 opencode-go 只有一个账号，按账号冷却会让免费模型的 429 把同账号下所有
	 * 模型一起拖下水（hy4-flash 限流时 deepseek 模型也整段不可用），这正是要修的问题。
	 * @param source - 来源
	 * @param accountId - 账号 ID
	 * @param status - 上游状态码
	 * @param retryAfterMs - 上游 Retry-After 换算的毫秒数
	 * @param model - 上游模型名；缺省按账号级冷却（调用方未提供模型时无法细分）
	 * @param detail - 上游错误摘要，拼进冷却原因，供后续「都在冷却中」的 429 回显真实原因
	 */
	markFailure(
		source: SubscriptionSource,
		accountId: string,
		status: number,
		retryAfterMs?: number,
		model?: string,
		detail?: string,
	): void {
		const fallback = status === 429 ? 30_000 : status === 401 || status === 402 || status === 403 ? 60_000 : status >= 500 ? 10_000 : 0;
		const duration = Math.max(0, retryAfterMs ?? fallback);
		if (duration <= 0) {
			return;
		}
		const key =
			isAccountScopedFailure(status) || model === undefined
				? this._cooldownKey(source, accountId)
				: this._modelCooldownKey(source, accountId, model);
		this._cooldown.set(key, {
			until: Date.now() + Math.min(duration, 15 * 60 * 1000),
			reason: detail ? `HTTP ${status}: ${detail}` : `HTTP ${status}`,
		});
	}

	/**
	 * 记录账号额度耗尽并设置较长冷却。
	 *
	 * 额度耗尽的恢复单位是额度窗口（小时/天级），不是 Retry-After，所以冷却比普通错误长；
	 * 目的不是精确等待恢复，而是让后续请求先改投还有额度的账号，避免同一会话被亲和
	 * 固定在一个空账号上反复失败。
	 * @param source - 来源
	 * @param accountId - 账号 ID
	 * @param reason - 展示用原因
	 * @param cooldownMs - 冷却毫秒数；缺省 30 分钟
	 */
	markExhausted(source: SubscriptionSource, accountId: string, reason: string, cooldownMs = 30 * 60 * 1000): void {
		const duration = Math.min(Math.max(cooldownMs, 60 * 1000), 60 * 60 * 1000);
		this._cooldown.set(this._cooldownKey(source, accountId), {
			until: Date.now() + duration,
			reason: reason,
		});
	}

	/**
	 * 记录账号成功并清除冷却。
	 *
	 * 同时清账号级与该模型的模型级条目：能成功返回说明凭证有效，也说明这个模型
	 * 在该账号上已经恢复，没有理由继续拦着后续请求。
	 * @param source - 来源
	 * @param accountId - 账号 ID
	 * @param model - 本次成功的上游模型名
	 */
	markSuccess(source: SubscriptionSource, accountId: string, model?: string): void {
		this._cooldown.delete(this._cooldownKey(source, accountId));
		if (model) {
			this._cooldown.delete(this._modelCooldownKey(source, accountId, model));
		}
	}

	/** 清空全部调度状态（账号增删后由管理面调用）。 */
	reset(): void {
		this._affinity.clear();
		this._weighted.clear();
		this._cooldown.clear();
	}

	private _key(source: SubscriptionSource, sessionKey: string): string {
		return `${source}\0${sessionKey}`;
	}

	private _cooldownKey(source: SubscriptionSource, accountId: string): string {
		return `${source}\0${accountId}`;
	}

	/**
	 * 模型级冷却键：同一账号下不同模型互不影响。
	 * @param source - 来源
	 * @param accountId - 账号 ID
	 * @param model - 上游模型名
	 */
	private _modelCooldownKey(source: SubscriptionSource, accountId: string, model: string): string {
		return `${source}\0${accountId}\0${model}`;
	}

	private _remember(source: SubscriptionSource, sessionKey: string, accountId: string): void {
		if (this._affinity.size >= this._maxAffinityEntries) {
			const oldest = this._affinity.keys().next().value;
			if (oldest !== undefined) {
				this._affinity.delete(oldest);
			}
		}
		this._affinity.set(this._key(source, sessionKey), { accountId: accountId, expiresAt: Date.now() + this._affinityTtlMs });
	}

	/**
	 * 平滑加权轮询：每次给每个候选增加 weight，选当前权重最大者并减去总权重。
	 * @param source - 来源
	 * @param accounts - 候选
	 */
	private _weightedPick(source: SubscriptionSource, accounts: readonly SubscriptionAccount[]): SubscriptionAccount {
		let state = this._weighted.get(source);
		if (!state) {
			state = { current: new Map<string, number>() };
			this._weighted.set(source, state);
		}
		const total = accounts.reduce((sum, account) => sum + account.weight, 0);
		let selected = accounts[0]!;
		let selectedWeight = Number.NEGATIVE_INFINITY;
		for (const account of accounts) {
			const weight = account.weight;
			const next = (state.current.get(account.id) ?? 0) + weight;
			state.current.set(account.id, next);
			if (next > selectedWeight) {
				selected = account;
				selectedWeight = next;
			}
		}
		state.current.set(selected.id, selectedWeight - total);
		return selected;
	}
}
