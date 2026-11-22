/**
 * deployment 级别的花费归属（provider / URL / 价格 / 账号）。
 *
 * 从 `router/RouterSpendInfo.ts` 抽出：该文件要读 provider registry 与上游快照，
 * 而 `SpendLog`、上游诊断上下文只要这份纯数据。让类型侧依赖一个叶子文件，
 * 而不是反过来把 provider registry 拖进类型与仓储的依赖图。
 */
import type { CustomCostPerToken, PeakPricingConfig } from "../cost/CostCalculator";
import type { UpstreamAccountRef } from "../router/UpstreamKeyIdentity";

/**
 * 一次实际上游调用归属到哪个 deployment：provider、URL、模型、价格与账号。
 */
export interface DeploymentSpendInfo {
	/** 实际执行 deployment 的 provider（custom_llm_provider ?? 从 litellm_params.model 前缀解析） */
	readonly customLlmProvider: string;
	/** 实际执行上游完整 URL（provider.transformRequest 产出，含路径） */
	readonly apiBase: string;
	/** deployment model_info.id（PY SpendLogs.model_id） */
	readonly modelId?: string;
	/**
	 * deployment litellm_params.model 完整模型名（含 provider 前缀）。
	 * PY reconstruct_model_name 的 metadata["deployment"] 等价物，
	 * 供 SpendLogs.model 列重建（SpendTracker.reconstructModelName）。
	 */
	readonly deploymentModel: string;
	/** deployment 自定义价格（per-token）；无任何价格配置时为 undefined */
	readonly customCostPerToken?: CustomCostPerToken;
	/** deployment 峰谷定价配置；未配置时为 undefined（按基础价计费） */
	readonly peakPricing?: PeakPricingConfig;
	/** 本次实际 key 的 SHA-256；未记录时缺省。 */
	readonly upstreamKeyHash?: string;
	/** 本次实际使用该 key 的账号/凭据；inline key 缺省。 */
	readonly upstreamAccount?: UpstreamAccountRef;
}
