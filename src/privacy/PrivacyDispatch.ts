/**
 * 发往上游前的脱敏调度。
 *
 * 中间件只登记请求级上下文、装好响应还原与统计；真正改写请求体发生在
 * Router / EmbeddingsEndpoint 已经确定最终 deployment、即将 fetch 上游的那一刻。
 * 这样 fallback、重试换到别的提供方时，按实际去向重新判定生效范围，
 * 而不是按客户端最初写的模型名提前猜测。
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { ApiError } from "../core/api/ApiError";
import { createModuleLogger } from "../core/utils/logger";
import type { PrivacyMaskingSettings } from "./PrivacyConfig";
import type { PrivacyContext } from "./PrivacyContext";
import { maskRequestBody, type PrivacyProtocol } from "./RequestBodyMasker";
import { isPrivacyScopeMatch, type PrivacyScopeTarget } from "./PrivacyScope";

const logger = createModuleLogger("privacy");

/** 请求级脱敏状态：中间件写入，上游调度点读取并补全实际去向 */
export interface PrivacyRequestState {
	/** 本请求的占位符上下文 */
	readonly context: PrivacyContext;
	/** 请求开始时读到的配置快照 */
	readonly settings: PrivacyMaskingSettings;
	/** 实际执行脱敏的提供方（未脱敏时为空） */
	provider: string;
	/** 实际执行脱敏的模型组名（未脱敏时为空） */
	model: string;
	/** 是否至少对一次上游请求做过脱敏 */
	masked: boolean;
}

/** 请求级状态存储 */
const storage = new AsyncLocalStorage<PrivacyRequestState>();

/**
 * 在请求级脱敏状态里执行后续处理。
 * @template T - 回调返回值类型
 * @param state - 请求级状态
 * @param callback - 后续处理（通常是 next()）
 * @returns 回调返回值
 */
export function runWithPrivacyRequest<T>(state: PrivacyRequestState, callback: () => T): T {
	return storage.run(state, callback);
}

/**
 * 读取当前请求的脱敏状态；没有登记过（例如该路径不脱敏）时返回 undefined。
 */
export function currentPrivacyRequest(): PrivacyRequestState | undefined {
	return storage.getStore();
}

/**
 * 命中 block 类型时抛出的错误。
 *
 * 继承 ApiError 以复用统一的错误响应序列化；路由层的重试与 fallback 会显式放行
 * 这个错误，避免同一条被拒的请求换个提供方再发一次。
 */
export class PrivacyBlockedError extends ApiError {
	/**
	 * @param kinds - 命中的类型
	 */
	constructor(readonly kinds: readonly string[]) {
		super(400, `Request rejected by privacy policy: ${kinds.join(", ")} detected`, "privacy_blocked");
	}

	/**
	 * 对齐既有 privacy_blocked 响应体，额外带上命中的类型列表。
	 */
	override toErrorBody(): Record<string, unknown> {
		return {
			error: {
				message: this.message,
				type: "privacy_blocked",
				code: "privacy_blocked",
				param: null,
				kinds: [...this.kinds],
			},
		};
	}
}

/**
 * 在真正发往上游之前，按最终 deployment 判定范围并脱敏请求体。
 *
 * 只处理 provider 已经构造好的请求体：图片生成 / 编辑由调用方跳过，
 * 请求体不是普通对象时（例如原始字节）也直接返回。
 * @param body - provider 构造出的上游请求体
 * @param target - 最终 deployment 的范围判定目标
 * @param protocol - 请求体协议
 * @returns 是否执行了脱敏
 * @throws {PrivacyBlockedError} 命中配置为拒绝的类型时
 * @throws {ApiError} fail-closed 且脱敏自身失败时
 */
export function applyPrivacyMaskingToUpstream(body: unknown, target: PrivacyScopeTarget, protocol: PrivacyProtocol): boolean {
	const state = storage.getStore();
	if (state === undefined) {
		return false;
	}
	if (typeof body !== "object" || body === null || Array.isArray(body)) {
		return false;
	}
	if (!isPrivacyScopeMatch(state.settings, target)) {
		return false;
	}
	try {
		maskRequestBody(body as Record<string, unknown>, state.context, protocol);
	} catch (error) {
		if (state.settings.failClosed) {
			logger.error("脱敏处理失败，按 fail-closed 拒绝请求", { error: error, provider: target.provider, model: target.modelName });
			throw new ApiError(503, "Privacy masking failed; request rejected");
		}
		logger.error("脱敏处理失败，按 fail-open 继续转发", { error: error, provider: target.provider, model: target.modelName });
		return false;
	}
	state.provider = target.provider;
	state.model = target.modelName;
	state.masked = true;
	const blockedKinds = state.context.blockedKinds;
	if (blockedKinds.length > 0) {
		logger.warn("请求包含拒绝替换的内容，按 privacy_masking 配置拒绝", {
			provider: target.provider,
			model: target.modelName,
			kinds: blockedKinds,
		});
		throw new PrivacyBlockedError(blockedKinds);
	}
	return true;
}
