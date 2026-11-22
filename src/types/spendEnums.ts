/**
 * 花费日志的纯枚举（调用类型与最终状态）。
 *
 * 单独成文件是为了让 `db/schema/spendLogs.ts`、`db/schema/activeRequests.ts` 这类最底层模块
 * 只依赖这一个叶子文件；`types/spend.ts` 引用了在途日志、路由追踪与 Express 增强，schema 一旦
 * 依赖它，仓储（schema 的使用者）就会被卷进上游的大依赖环。
 */

/**
 * 调用类型枚举（SpendLog.call_type）
 *
 * 对齐 PY litellm.proxy.spend_tracking 的 call_type 字段，标识该 SpendLog 来自哪类入口：
 * - ACompletion: OpenAI 异步 Chat Completions（acompletion 路径）
 * - Completion: OpenAI 同步 Chat Completions
 * - AMessages: Anthropic Messages 异步（amessages 路径）
 * - AEmbedding: 异步 embedding 调用
 * - Embedding: 同步 embedding 调用
 * - AImageGeneration: 异步图像生成
 * - ImageGeneration: 同步图像生成
 * - ASearch / Search: 直连 Search 工具接口（非模型调用，按次计费）
 */
export enum CallType {
	ACompletion = "acompletion",
	AResponses = "aresponses",
	Completion = "completion",
	AMessages = "amessages",
	AEmbedding = "aembedding",
	Embedding = "embedding",
	AImageGeneration = "aimage_generation",
	ImageGeneration = "image_generation",
	ATranscription = "atranscription",
	Transcription = "transcription",
	ASpeech = "aspeech",
	Speech = "speech",
	ASearch = "asearch",
	Search = "search",
}

/**
 * SpendLog 最终状态（SpendLog.status）
 *
 * 对齐 PY `litellm/proxy/_types.py` SpendLogsMetadata.status：
 * - Success: 请求成功且 usage 已计费
 * - Failure: 请求失败（上游错误、timeout 等）
 * - Cancelled: 下游主动断开后，网关按取消策略终止了上游工作
 * - Aborted: 请求完成前因客户端断开或网关重启而中止，保留已观测的 usage 与费用
 */
export enum SpendLogStatus {
	Success = "success",
	Failure = "failure",
	Cancelled = "cancelled",
	Aborted = "aborted",
}
