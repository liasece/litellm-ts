/**
 * 上游身份的内部传递结构。
 *
 * 身份只在 Router → spend 结算之间短暂存在：`keyHash` 进入 SpendLogs 列，
 * `account` 进入关联表；两者都不写进 provider 请求、响应或前端响应。
 */

/** 订阅账号或 LLM Credential。 */
export type UpstreamAccountKind = "subscription" | "credential";

/** 实际使用了一个上游 key 的账号身份。 */
export interface UpstreamAccountRef {
	/** 账号种类；决定 account_id 指向订阅账号表还是 Credential 表。 */
	readonly kind: UpstreamAccountKind;
	/** 订阅账号 ID 或不可变的 Credential 名。 */
	readonly id: string;
	/** 上游来源（订阅 source）或部署 provider。 */
	readonly provider: string;
}

/** 一次上游调用的 key 指纹与账号身份。 */
export interface UpstreamIdentity {
	/** 实际 key 的 SHA-256。 */
	readonly keyHash: string;
	/** inline key 没有账号，此时缺省。 */
	readonly account?: UpstreamAccountRef;
}

const UPSTREAM_IDENTITY = Symbol("litellm.upstreamIdentity");

/**
 * 把身份挂到本次解析出的 deployment 上。
 *
 * 使用不可枚举 Symbol，避免进入 provider 参数、认证头、日志或 API 序列化；
 * Router 后续的 `buildDeploymentSpendInfo` 读取同一对象即可拿到。
 * @template T - deployment 对象类型
 * @param deployment - 本次请求的已解析 deployment
 * @param identity - 实际 key 与账号；没有可记录身份时保持对象原样
 */
export function attachUpstreamIdentity<T extends object>(deployment: T, identity: UpstreamIdentity | undefined): T {
	if (identity !== undefined) {
		Object.defineProperty(deployment, UPSTREAM_IDENTITY, {
			value: identity,
			configurable: true,
			enumerable: false,
			writable: true,
		});
	}
	return deployment;
}

/**
 * 读取 deployment 上挂载的身份。
 * @param deployment - Router 解析出的 deployment
 */
export function getUpstreamIdentity(deployment: unknown): UpstreamIdentity | undefined {
	if (typeof deployment !== "object" || deployment === null) {
		return undefined;
	}
	return (deployment as { [UPSTREAM_IDENTITY]?: UpstreamIdentity })[UPSTREAM_IDENTITY];
}
