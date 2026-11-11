/**
 * 原生订阅执行层的公共契约。
 *
 * 这一层替代此前的 Go 订阅子进程：账号、OAuth 刷新、调度、协议转换与
 * 上游执行都在当前 Node 进程内完成，现有端点仍按原协议与 Provider 交互。
 */

/** 订阅账号来源；与公开的 custom_llm_provider 分开保存。 */
export type SubscriptionSource = "codex" | "claude" | "kimi" | "antigravity" | "xai" | "commandcode" | "opencode-go";

/** 客户端入口协议。 */
export type SubscriptionInboundProtocol = "chat" | "messages" | "responses" | "gemini";

/** 上游实际使用的协议；antigravity 使用 Google 私有信封。 */
export type SubscriptionWireProtocol = SubscriptionInboundProtocol | "gemini";

/** 订阅端点支持的操作。 */
export type SubscriptionOperation =
	| "chat"
	| "messages"
	| "responses"
	| "completions"
	| "images.generations"
	| "images.edits"
	| "compact"
	| "count_tokens"
	| "videos"
	| "speech"
	| "alpha.search"
	| "live"
	| "realtime"
	| "models";

/** 一个磁盘上的订阅账号。 */
export interface SubscriptionAccount {
	/** 稳定账号标识，跨重启与文件改名保持不变。 */
	readonly id: string;
	/** 账号来源。 */
	readonly source: SubscriptionSource;
	/** 文件名（不含目录）。 */
	readonly fileName: string;
	/** 绝对路径。 */
	readonly path: string;
	/** 运维是否显式禁用。 */
	readonly disabled: boolean;
	/** 调度权重；0 表示暂停参与调度，缺省为 1。 */
	readonly weight: number;
	/** 调度优先级；数值越小越优先，缺省为 0。 */
	readonly priority?: number;
	/** 管理面展示的状态，例如 disabled (invalid grant)。 */
	readonly status?: string;
	/** 最近一次刷新/上游错误。 */
	readonly lastError?: string;
	/** 连续刷新失败次数。 */
	readonly refreshFailures?: number;
	/** 展示用邮箱。 */
	readonly email?: string;
	/** 展示用标签。 */
	readonly label?: string;
	/** access token 到期时间（毫秒时间戳）。 */
	readonly expiresAt?: number;
	/** 原始 auth JSON，保留所有未知字段以便无损写回。 */
	readonly raw: Record<string, unknown>;
}

/** 最近一次上游响应携带的额度/限流快照。 */
export interface SubscriptionRateLimitSnapshot {
	/** 抓取时间（ISO）。 */
	readonly capturedAt: string;
	/** 是否处于限流/额度耗尽状态。 */
	readonly limited: boolean;
	/** Retry-After 秒数；可由日期换算。 */
	readonly retryAfterSeconds?: number;
	/** 上游返回的限流相关头，键已小写。 */
	readonly headers: Record<string, string>;
}

/** 一次订阅执行的上下文。 */
export interface SubscriptionRequestContext {
	/** 账号来源。 */
	readonly source: SubscriptionSource;
	/** 端点操作。 */
	readonly operation: SubscriptionOperation;
	/** 请求中的模型 ID（已去掉 provider 前缀）。 */
	readonly model: string;
	/** 客户端入口协议。 */
	readonly inbound: SubscriptionInboundProtocol;
	/** 客户端请求体。 */
	readonly body: Record<string, unknown>;
	/** 从客户端/部署带下来的请求头。 */
	readonly headers: Record<string, string>;
	/** 原始请求体；multipart/二进制操作使用。 */
	readonly rawBody?: unknown;
	/** 是否期望流式响应。 */
	readonly stream: boolean;
	/** 调用方取消信号。 */
	readonly signal?: AbortSignal;
	/** 会话亲和键。 */
	readonly sessionKey: string;
}

/** 上游请求计划。 */
export interface SubscriptionUpstreamPlan {
	/** 上游 URL。 */
	readonly url: string;
	/** HTTP 方法。 */
	readonly method: "POST" | "GET";
	/** 上游请求头。 */
	readonly headers: Record<string, string>;
	/** 上游请求体；multipart 透传时为空。 */
	readonly body?: unknown;
	/** body 的编码方式。 */
	readonly bodyEncoding?: "json" | "raw";
	/** 供上游日志使用的脱敏 body；缺省由桥接层处理图片 data URL。 */
	readonly logBody?: unknown;
	/** 客户端非流式、但上游强制 SSE 时，由桥接层聚合最终响应。 */
	readonly aggregateSse?: boolean;
	/** 是否流式。 */
	readonly stream: boolean;
	/** 上游协议。 */
	readonly protocol: SubscriptionWireProtocol;
	/** 上游模型 ID。 */
	readonly model: string;
	/** 安全工具名到客户端名称的映射；桥接层在响应/SSE 回到客户端前还原。 */
	readonly toolNames?: ReadonlyMap<string, string>;
}

/** 适配器构造上游请求时可见的上下文。 */
export interface SubscriptionUpstreamContext extends SubscriptionRequestContext {
	/** 适配器选择的上游协议。 */
	readonly upstream: SubscriptionWireProtocol;
	/** 已按协议翻译、尚未做 provider 特化的上游请求体。 */
	readonly upstreamBody: Record<string, unknown>;
	/** 选中的账号。 */
	readonly account: SubscriptionAccount;
	/** 账号凭据：OAuth access token 或 API key。 */
	readonly credential: string;
}

/** 目录中的一条模型。 */
export interface SubscriptionCatalogModel {
	/** 对外公开的模型 ID（含 provider 前缀时由调用方处理）。 */
	readonly id: string;
	/** 上游原生模型 ID。 */
	readonly upstreamId?: string;
	/** 展示名。 */
	readonly displayName?: string;
	/** 该模型的路由协议。 */
	readonly protocol?: SubscriptionWireProtocol;
	/** 额外元数据。 */
	readonly metadata?: Record<string, unknown>;
}

/** 归一化后的额度窗口。 */
export interface SubscriptionQuotaWindow {
	/** 窗口名称。 */
	readonly name: string;
	/** 剩余比例 0..1；未知时缺省。 */
	readonly remainingFraction?: number;
	/** 重置时间（ISO 8601）。 */
	readonly resetTime?: string;
	/** 原始窗口。 */
	readonly raw?: Record<string, unknown>;
}

/** 一个账号的额度快照。 */
export interface SubscriptionQuotaSnapshot {
	/** 套餐名。 */
	readonly plan?: string;
	/** 到期时间（ISO 8601）。 */
	readonly expiresAt?: string;
	/** 余额/积分等键值。 */
	readonly balances?: Record<string, number>;
	/** 窗口列表。 */
	readonly windows?: readonly SubscriptionQuotaWindow[];
	/** 抓取时间（ISO 8601）。 */
	readonly fetchedAt: string;
	/** 抓取失败时的错误。 */
	readonly error?: string;
}

/** 登录会话状态。 */
export type SubscriptionLoginState = "pending" | "success" | "error";

/** 仪表盘可见的登录会话。 */
export interface SubscriptionLoginSession {
	/** 会话 ID。 */
	readonly id: string;
	/** 当前状态。 */
	readonly state: SubscriptionLoginState;
	/** 需要用户打开的 URL。 */
	readonly url?: string;
	/** 终端式输出行。 */
	readonly output: readonly string[];
	/** 需要用户输入的提示。 */
	readonly prompt?: string;
	/** 失败原因。 */
	readonly error?: string;
}

/** 账号鉴权与刷新。 */
export interface SubscriptionAuthHandler {
	/** 账号来源。 */
	readonly source: SubscriptionSource;
	/**
	 * 返回可用凭据；必要时在此等待刷新完成。
	 * @param account - 选中账号
	 */
	ensureCredential(account: SubscriptionAccount): Promise<string>;
	/**
	 * 按请求头返回可用凭据；用于同一账号内多套 token 分区（如 Codex SIWC）。
	 * @param account - 选中账号
	 * @param headers - 客户端请求头
	 */
	ensureCredentialForRequest?(account: SubscriptionAccount, headers: Record<string, string>): Promise<string>;
	/**
	 * 强制刷新账号凭据并写回磁盘。
	 * @param account - 选中账号
	 */
	refresh(account: SubscriptionAccount): Promise<void>;
	/**
	 * 按请求头强制刷新对应 token 分区。
	 * @param account - 选中账号
	 * @param headers - 客户端请求头
	 */
	refreshForRequest?(account: SubscriptionAccount, headers: Record<string, string>): Promise<void>;
	/**
	 * 启动交互式登录（仅 OAuth/设备码来源）。
	 */
	startLogin?(): Promise<SubscriptionLoginSession>;
	/**
	 * 轮询登录状态。
	 * @param id - 会话 ID
	 */
	pollLogin?(id: string): Promise<SubscriptionLoginSession>;
	/**
	 * 提交登录过程中需要的输入。
	 * @param id - 会话 ID
	 * @param input - 用户输入
	 */
	submitLoginInput?(id: string, input: string): Promise<SubscriptionLoginSession>;
	/**
	 * 取消并清理登录会话。
	 * @param id - 会话 ID
	 */
	cancelLogin?(id: string): Promise<void>;
}

/** 一家订阅 Provider 的协议适配器。 */
export interface SubscriptionProviderAdapter {
	/** 账号来源。 */
	readonly source: SubscriptionSource;
	/** 展示名。 */
	readonly displayName: string;
	/** 鉴权处理器。 */
	readonly auth: SubscriptionAuthHandler;
	/**
	 * 该操作/模型是否由本适配器承接。
	 * @param operation - 端点操作
	 * @param model - 上游模型
	 */
	supports(operation: SubscriptionOperation, model: string): boolean;
	/**
	 * 选择该请求的上游协议。
	 * @param context - 请求上下文
	 */
	route(context: SubscriptionRequestContext): SubscriptionWireProtocol;
	/**
	 * 把公开模型映射为上游模型；缺省原样返回。
	 * @param model - 公开模型 ID
	 */
	resolveModel?(model: string): string;
	/**
	 * 构造上游请求；可在 upstreamBody 上做 provider 特化。
	 * @param context - 含凭据与已翻译请求体的上下文
	 */
	build(context: SubscriptionUpstreamContext): Promise<SubscriptionUpstreamPlan>;
	/**
	 * 上游响应体在翻译回入口协议前的特化处理。
	 * @param context - 请求上下文
	 * @param body - 上游 JSON
	 */
	transformUpstreamBody?(context: SubscriptionRequestContext, body: Record<string, unknown>): Record<string, unknown>;
	/**
	 * 上游 SSE 事件在翻译前的特化处理；返回 null 表示丢弃该事件。
	 * @param context - 请求上下文
	 * @param event - 上游事件
	 */
	transformUpstreamEvent?(context: SubscriptionRequestContext, event: Record<string, unknown>): Record<string, unknown> | null;
	/**
	 * 翻译回入口协议后的最终修饰。
	 * @param context - 请求上下文
	 * @param body - 入口协议 JSON
	 */
	transformInboundBody?(context: SubscriptionRequestContext, body: Record<string, unknown>): Record<string, unknown>;
	/**
	 * 翻译回入口协议后的 SSE 事件修饰；返回 null 表示丢弃。
	 * @param context - 请求上下文
	 * @param event - 入口协议事件
	 */
	transformInboundEvent?(context: SubscriptionRequestContext, event: Record<string, unknown>): Record<string, unknown> | null;
	/**
	 * 本地计算 count_tokens；实现后桥接层不再访问上游。
	 * @param context - 请求上下文
	 */
	countTokens?(context: SubscriptionRequestContext): Promise<number>;
	/**
	 * 拉取模型目录。
	 */
	catalog(): Promise<readonly SubscriptionCatalogModel[]>;
	/**
	 * 查询一个账号的额度。
	 * @param account - 选中账号
	 */
	quota(account: SubscriptionAccount): Promise<SubscriptionQuotaSnapshot>;
}

/** 账号来源到公开 provider 的反向映射。 */
export const SUBSCRIPTION_SOURCE_TO_PROVIDER = {
	codex: "codex-subscription",
	claude: "claude-subscription",
	kimi: "kimi-subscription",
	antigravity: "antigravity-subscription",
	xai: "xai-subscription",
	commandcode: "commandcode",
	"opencode-go": "opencode-go",
} as const;

/** 公开 provider 到账号来源的映射。 */
export const SUBSCRIPTION_PROVIDER_TO_SOURCE = {
	"codex-subscription": "codex",
	"claude-subscription": "claude",
	"kimi-subscription": "kimi",
	"antigravity-subscription": "antigravity",
	"xai-subscription": "xai",
	commandcode: "commandcode",
	"opencode-go": "opencode-go",
} as const;

/**
 * 判断字符串是否为订阅来源。
 * @param value - 待判定值
 */
export function isSubscriptionSource(value: unknown): value is SubscriptionSource {
	return typeof value === "string" && Object.hasOwn(SUBSCRIPTION_SOURCE_TO_PROVIDER, value);
}
