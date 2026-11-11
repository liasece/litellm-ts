/**
 * Claude Messages 上游请求的协议特化。
 *
 * 这里只做 Claude 专属的部分：Messages / count_tokens 端点 URL、OAuth 与 Claude
 * Code 客户端头、system 与 Cloaking、采样参数校正、cache_control 放置、工具块
 * 归一化、压缩胶囊，以及响应模型名回写。Chat / Responses 入口的协议翻译由桥接层
 * 的通用翻译器完成，不在这里重复。
 *
 * 参考实现是 CLIProxyAPI 的 `internal/runtime/executor/claude_*`；本模块保留协议
 * 语义（头、默认值、字段约束），但不依赖 Go 的 ojson 构建器。
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { catalogForSource } from "../catalog/catalog";
import type { SubscriptionAccount, SubscriptionRequestContext } from "../types";
import { claudeBillingHeader, signClaudeCchBody, type ClaudeCchSignatureHook } from "./claudeCch";

/** Anthropic 官方 API 基址。 */
export const CLAUDE_DEFAULT_BASE_URL = "https://api.anthropic.com";

/** Anthropic API 版本头默认值。 */
export const CLAUDE_ANTHROPIC_VERSION = "2023-06-01";

/** 模拟的 Claude Code 客户端版本。 */
export const CLAUDE_CODE_VERSION = "2.1.280";

/** 模拟的 Claude Code User-Agent。 */
export const CLAUDE_CODE_USER_AGENT = "claude-cli/2.1.280 (external, cli)";

/** Claude Code CLI 身份 system 块。 */
export const CLAUDE_CODE_CLI_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";

/** Claude Code 2.1.280 的 Fable 系列附加 system 块。 */
const CLAUDE_CODE_FABLE_REPORTING_OUTCOMES =
	`# Reporting outcomes

Report what actually happened, not what you intended. When you say something is done, sent, saved, fixed, or verified, that claim must rest on a result you observed in this session — tool output, the file as it now reads, the page as it now loads — not on what the step should have produced. If you did not check, say you did not check. If any step failed, was skipped, or came back different from what you expected, say so in the first sentence of your report, before anything else, even when the rest of the work succeeded. Never quietly work around a failure in a way that makes it look resolved; a problem the user can see is recoverable, one your summary hides is not. When you stop before the task is complete, your first line says so plainly and names what is left. Do not describe partial work as done, and do not let a summary read as more certain than the evidence behind it.`;

/** 每个 Messages 请求都会带上的 Claude Code betas。 */
const CLAUDE_CODE_CONSTANT_BETAS: readonly string[] = [
	"interleaved-thinking-2025-05-14",
	"redact-thinking-2026-02-12",
	"thinking-token-count-2026-05-13",
	"context-management-2025-06-27",
	"prompt-caching-scope-2026-01-05",
];

/** 由调用方按需声明的尾部 betas。 */
const CLAUDE_CODE_TRAILING_BETAS: readonly string[] = [
	"server-side-fallback-2026-06-01",
	"fallback-credit-2026-06-01",
	"structured-outputs-2025-12-15",
];

/** 适配器自己管理、不原样透传的 betas。 */
const CLAUDE_MANAGED_BETAS: ReadonlySet<string> = new Set([
	"token-counting-2024-11-01",
	"fast-mode-2026-02-01",
	"oauth-2025-04-20",
	"claude-code-20250219",
	"context-1m-2025-08-07",
	"mid-conversation-system-2026-04-07",
	"per-turn-control-2026-07-01",
	"timing-2026-09-09",
	"mid-conversation-tool-changes-2026-07-01",
	"inline-tools-2026-09-15",
	"mid-conversation-system-clear-at-2026-08-21",
	"dangerous-tool-use-2026-09-03",
	"advisor-tool-2026-03-01",
	"advanced-tool-use-2025-11-20",
	"effort-2025-11-24",
	"server-side-fallback-2026-06-01",
	"fallback-credit-2026-06-01",
	"structured-outputs-2025-12-15",
	"thinking-display-updates-2026-08-18",
	"thinking-binding-controls-2026-08-01",
	"thinking-resumption-2026-07-17",
	"extended-cache-ttl-2025-04-11",
	"prompt-caching-evict-2026-05-12",
	"cache-diagnosis-2026-04-07",
	"redact-thinking-2026-02-12",
	"afk-mode-2026-01-31",
	...CLAUDE_CODE_CONSTANT_BETAS,
	...CLAUDE_CODE_TRAILING_BETAS,
]);

/** 旧模型：不支持 mid-conversation role=system 消息。 */
const CLAUDE_LEGACY_SYSTEM_REMINDER_MODELS: ReadonlySet<string> = new Set([
	"claude-3-5-haiku-20241022",
	"claude-3-5-haiku-latest",
	"claude-3-7-sonnet-20250219",
	"claude-3-7-sonnet-latest",
	"claude-haiku-4-5",
	"claude-haiku-4-5-20251001",
	"claude-opus-4",
	"claude-opus-4-20250514",
	"claude-opus-4-1",
	"claude-opus-4-1-20250805",
	"claude-opus-4-5",
	"claude-opus-4-5-20251101",
	"claude-opus-4-6",
	"claude-opus-4-7",
	"claude-sonnet-4",
	"claude-sonnet-4-20250514",
	"claude-sonnet-4-5",
	"claude-sonnet-4-5-20250929",
	"claude-sonnet-4-6",
]);

/** 压缩胶囊前缀。 */
const CLAUDE_COMPACTION_CAPSULE_PREFIX = "cpa-ag-compact-v1:";

/** 压缩摘要提示词。 */
const CLAUDE_COMPACTION_SUMMARY_PROMPT =
	"Please provide a concise and comprehensive summary of the preceding conversation and task progress so far, including user goals, key findings, actions taken, and current status, so that work can continue smoothly.";

/** 一个待转发的 system 文本块。 */
interface ClaudeSystemBlock {
	/** 文本。 */
	readonly text: string;
	/** 调用方声明的 cache_control。 */
	readonly cacheControl?: Record<string, unknown>;
}

/** Claude 请求设置；由 Provider 工厂注入。 */
export interface ClaudeRequestSettings {
	/** 覆盖上游基址。 */
	readonly baseUrl?: string;
	/** 覆盖 anthropic-version。 */
	readonly anthropicVersion?: string;
	/** 覆盖客户端版本号（计费头）。 */
	readonly clientVersion?: string;
	/** 覆盖 User-Agent。 */
	readonly userAgent?: string;
	/** 是否套用 Claude Code Cloaking；缺省启用。 */
	readonly cloaking?: boolean;
	/** 是否计算 CCH 签名；缺省与 cloaking 同步。 */
	readonly cchSigning?: boolean;
	/** 追加的 betas。 */
	readonly extraBetas?: readonly string[];
	/** 覆盖会话 ID 解析。 */
	readonly sessionId?: (context: SubscriptionRequestContext) => string;
	/** 覆盖设备 ID。 */
	readonly deviceId?: string;
	/** 覆盖账号 UUID。 */
	readonly accountUuid?: string;
	/** CCH 签名钩子。 */
	readonly cchHook?: ClaudeCchSignatureHook;
	/** 覆盖默认 max_tokens 解析。 */
	readonly maxTokens?: (model: string) => number | undefined;
}

/** 构造请求头所需的上下文。 */
export interface ClaudeHeaderInput {
	/** 请求上下文。 */
	readonly context: SubscriptionRequestContext;
	/** 选中账号。 */
	readonly account: SubscriptionAccount;
	/** 凭据。 */
	readonly credential: string;
	/** 上游基址。 */
	readonly baseUrl: string;
	/** 上游模型。 */
	readonly model: string;
	/** 已特化的请求体。 */
	readonly body: Record<string, unknown>;
	/** 适配器设置。 */
	readonly settings: ClaudeRequestSettings;
	/** 是否 count_tokens 端点。 */
	readonly countTokens: boolean;
}

/** 构造请求体所需的上下文。 */
export interface ClaudeBodyInput {
	/** 桥接层给出的上游请求体。 */
	readonly body: Record<string, unknown>;
	/** 请求上下文。 */
	readonly context: SubscriptionRequestContext;
	/** 选中账号。 */
	readonly account: SubscriptionAccount;
	/** 上游模型。 */
	readonly model: string;
	/** 适配器设置。 */
	readonly settings: ClaudeRequestSettings;
}

/** 特化后的请求体。 */
export interface ClaudePreparedBody {
	/** 请求体。 */
	readonly body: Record<string, unknown>;
	/** 是否需要 CCH 签名。 */
	readonly signable: boolean;
	/** 最终发送的原始文本（需要签名时直接作为 raw body）。 */
	readonly raw?: string;
}

/**
 * 解析上游基址。
 * @param account - 账号
 * @param settings - 适配器设置
 * @returns 不带尾斜杠的基址
 */
export function resolveClaudeBaseUrl(account: SubscriptionAccount, settings: ClaudeRequestSettings): string {
	const candidates: unknown[] = [account.raw["base_url"], settings.baseUrl, CLAUDE_DEFAULT_BASE_URL];
	for (const candidate of candidates) {
		if (typeof candidate === "string" && candidate.trim()) {
			return candidate.trim().replace(/\/+$/, "");
		}
	}
	return CLAUDE_DEFAULT_BASE_URL;
}

/**
 * 解析 Messages / count_tokens 端点。
 * @param baseUrl - 基址
 * @param countTokens - 是否 count_tokens
 * @returns 端点 URL
 */
export function claudeMessagesEndpoint(baseUrl: string, countTokens: boolean): string {
	return countTokens ? `${baseUrl}/v1/messages/count_tokens?beta=true` : `${baseUrl}/v1/messages?beta=true`;
}

/**
 * 读取目录中某模型的最大输出 token 数。
 * @param model - 上游模型
 * @returns 目录值；未知模型返回 undefined
 */
export function claudeModelMaxOutputTokens(model: string): number | undefined {
	const entry = catalogForSource("claude").find((candidate) => candidate.id === model);
	const value = entry?.metadata?.["maxOutputTokens"];
	return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * 解析请求体中的默认 max_tokens。
 * @param model - 上游模型
 * @param settings - 适配器设置
 * @returns 默认值；目录未知时 1024
 */
export function claudeDefaultMaxTokens(model: string, settings: ClaudeRequestSettings): number {
	const custom = settings.maxTokens?.(model);
	if (custom !== undefined && Number.isFinite(custom) && custom > 0) {
		return Math.floor(custom);
	}
	return claudeModelMaxOutputTokens(model) ?? 1024;
}

/**
 * 构造 Claude 上游请求头。
 * @param input - 请求头上下文
 * @returns 请求头
 */
export function claudeRequestHeaders(input: ClaudeHeaderInput): Record<string, string> {
	const settings = input.settings;
	const sessionId = resolveClaudeSessionId(input.context, input.account, settings);
	const headers: Record<string, string> = {
		"Content-Type": "application/json",
		Accept: input.context.stream ? "text/event-stream" : "application/json",
		Authorization: `Bearer ${input.credential}`,
		"anthropic-version": headerValue(input.context.headers, "anthropic-version") ?? settings.anthropicVersion ?? CLAUDE_ANTHROPIC_VERSION,
		"user-agent": settings.userAgent?.trim() || CLAUDE_CODE_USER_AGENT,
		"x-app": "cli",
		"anthropic-dangerous-direct-browser-access": "true",
		"x-stainless-lang": "js",
		"x-stainless-runtime": "node",
		"x-stainless-runtime-version": "v26.3.0",
		"x-stainless-package-version": "0.112.1",
		"x-stainless-os": "MacOS",
		"x-stainless-arch": "arm64",
		"x-stainless-retry-count": "0",
		"x-client-request-id": randomUUID(),
		"x-claude-code-session-id": sessionId,
		"accept-encoding": "gzip, deflate, br, zstd",
		connection: "keep-alive",
	};
	if (!input.countTokens) {
		headers["x-stainless-timeout"] = "600";
	}
	const betas = claudeBetaList(input, sessionId);
	if (betas.length > 0) {
		headers["anthropic-beta"] = betas.join(",");
	}
	return headers;
}

/**
 * 组装本次请求的 beta 列表。
 * @param input - 请求头上下文
 * @param sessionId - 解析后的会话 ID
 * @returns 去重后的 betas
 */
function claudeBetaList(input: ClaudeHeaderInput, sessionId: string): string[] {
	void sessionId;
	const requested = new Set<string>(splitBetas(headerValue(input.context.headers, "anthropic-beta")));
	// `betas` 是客户端控制头，不是 Anthropic 请求体字段；请求体在签名前删除，
	// 这里从入口上下文读取，避免被 prepare 后的 body 隐藏。
	for (const beta of splitBetas(input.context.body["betas"] ?? input.body["betas"])) {
		requested.add(beta);
	}
	for (const beta of input.settings.extraBetas ?? []) {
		if (beta.trim()) {
			requested.add(beta.trim());
		}
	}
	const unknown = [...requested].filter((beta) => !CLAUDE_MANAGED_BETAS.has(beta));
	if (input.countTokens) {
		return [
			"claude-code-20250219",
			"oauth-2025-04-20",
			"interleaved-thinking-2025-05-14",
			"context-management-2025-06-27",
			"token-counting-2024-11-01",
			...unknown,
		];
	}
	const betas: string[] = ["claude-code-20250219", "oauth-2025-04-20"];
	if (modelHasOneMillionContext(input.context.model, input.model)) {
		betas.push("context-1m-2025-08-07");
	}
	const model = input.model.toLowerCase();
	const legacy = CLAUDE_LEGACY_SYSTEM_REMINDER_MODELS.has(model);
	const thinkingType = textOf(recordOf(input.body["thinking"])?.["type"])?.toLowerCase();
	const thinkingDisabled = thinkingType === "disabled";
	for (const beta of CLAUDE_CODE_CONSTANT_BETAS) {
		if (beta === "redact-thinking-2026-02-12" && thinkingDisplaySet(input.body)) {
			continue;
		}
		betas.push(beta);
	}
	if (!legacy) {
		betas.push("mid-conversation-system-2026-04-07");
		if (isOpus55(model) || isFable51(model) || requested.has("per-turn-control-2026-07-01")) {
			betas.push("per-turn-control-2026-07-01");
		}
		if (requested.has("timing-2026-09-09")) {
			betas.push("timing-2026-09-09");
		}
		if (!isSonnet5(model)) {
			betas.push("mid-conversation-tool-changes-2026-07-01");
		}
		if (requested.has("inline-tools-2026-09-15")) {
			betas.push("inline-tools-2026-09-15");
		}
	} else {
		if (isOpus55(model) || isFable51(model) || requested.has("per-turn-control-2026-07-01")) {
			betas.push("per-turn-control-2026-07-01");
		}
		if (requested.has("timing-2026-09-09")) {
			betas.push("timing-2026-09-09");
		}
	}
	if (requested.has("advisor-tool-2026-03-01") || hasAdvisorHistory(input.body)) {
		betas.push("advisor-tool-2026-03-01");
	}
	if (requested.has("advanced-tool-use-2025-11-20")) {
		betas.push("advanced-tool-use-2025-11-20");
	}
	if (!legacy && requested.has("mid-conversation-system-clear-at-2026-08-21")) {
		betas.push("mid-conversation-system-clear-at-2026-08-21");
	}
	if (requested.has("dangerous-tool-use-2026-09-03") || input.body["safeguards"] !== undefined) {
		betas.push("dangerous-tool-use-2026-09-03");
	}
	if (!model.includes("haiku") && !thinkingDisabled) {
		betas.push("effort-2025-11-24");
	}
	if (requested.has("server-side-fallback-2026-06-01") || input.body["fallbacks"] !== undefined) {
		betas.push("server-side-fallback-2026-06-01");
	}
	if (
		requested.has("fallback-credit-2026-06-01") ||
		input.body["fallback_credit_token"] !== undefined ||
		input.body["fallbacks"] !== undefined
	) {
		betas.push("fallback-credit-2026-06-01");
	}
	for (const beta of CLAUDE_CODE_TRAILING_BETAS) {
		if (requested.has(beta) && !betas.includes(beta)) {
			betas.push(beta);
		}
	}
	if (requested.has("thinking-binding-controls-2026-08-01") || recordOf(recordOf(input.body["thinking"])?.["block_binding"])) {
		betas.push("thinking-binding-controls-2026-08-01");
	}
	if (!thinkingDisabled && (requested.has("thinking-display-updates-2026-08-18") || thinkingDisplayUpdates(input.body))) {
		betas.push("thinking-display-updates-2026-08-18");
	}
	if (requested.has("thinking-resumption-2026-07-17")) {
		betas.push("thinking-resumption-2026-07-17");
	}
	if (textOf(input.body["speed"]) === "fast" || requested.has("fast-mode-2026-02-01")) {
		betas.push("fast-mode-2026-02-01");
	}
	if (requested.has("afk-mode-2026-01-31")) {
		betas.push("afk-mode-2026-01-31");
	}
	betas.push("extended-cache-ttl-2025-04-11");
	if (requested.has("prompt-caching-evict-2026-05-12") || hasOneHourCacheControl(input.body) || containsEvictOption(input.body)) {
		betas.push("prompt-caching-evict-2026-05-12");
	}
	if (recordOf(input.body["diagnostics"]) !== undefined) {
		betas.push("cache-diagnosis-2026-04-07");
	}
	return [...new Set([...betas, ...unknown])];
}

/**
 * 特化 Messages 请求体。
 * @param input - 请求体上下文
 * @returns 特化结果
 */
export function prepareClaudeMessagesBody(input: ClaudeBodyInput): ClaudePreparedBody {
	const body = cloneRecord(input.body);
	const model = input.model;
	const settings = input.settings;
	body["model"] = model;
	// 客户端用 body.betas 声明 beta；它只能进入 anthropic-beta 头。
	delete body["betas"];
	const explicitCache = body["prompt_cache_options"] !== undefined;
	const cloaking = settings.cloaking !== false;
	const systemBlocks = normalizeSystemBlocks(body["system"]);
	delete body["system"];

	if (body["max_tokens"] === undefined) {
		body["max_tokens"] = claudeDefaultMaxTokens(model, settings);
	}
	applyThinkingSuffix(body, input.context.model);
	disableThinkingWhenToolChoiceForced(body);
	normalizeClaudeSampling(body);
	applyPreservedThinkingBinding(body, model);
	normalizeClaudeMessages(body);
	normalizeClaudeTools(body);
	normalizeStopSequences(body);

	let signable = false;
	if (cloaking) {
		const version = settings.clientVersion?.trim() || CLAUDE_CODE_VERSION;
		const signing = settings.cchSigning !== false;
		const billing = claudeBillingHeader({
			version: version,
			messageText: firstUserMessageText(body),
			cch: signing,
		});
		const topLevel: Record<string, unknown>[] = [
			{ type: "text", text: billing },
			explicitCache
				? { type: "text", text: CLAUDE_CODE_CLI_IDENTITY }
				: { type: "text", text: CLAUDE_CODE_CLI_IDENTITY, cache_control: { type: "ephemeral" } },
		];
		if (isFable51(model.toLowerCase())) {
			topLevel.push({ type: "text", text: CLAUDE_CODE_FABLE_REPORTING_OUTCOMES });
		}
		const forwarded = systemBlocks.filter((block) => block.text.trim().length > 0);
		if (hasAdvisorHistory(body)) {
			topLevel.push(...forwarded.map((block) => forwardedSystemBlock(block, explicitCache)));
		} else if (CLAUDE_LEGACY_SYSTEM_REMINDER_MODELS.has(model.toLowerCase())) {
			prependSystemReminders(body, forwarded, explicitCache);
		} else if (forwarded.length > 0 && !insertMidConversationSystem(body, forwarded, explicitCache)) {
			topLevel.push(...forwarded.map((block) => forwardedSystemBlock(block, explicitCache)));
		}
		body["system"] = topLevel;
		applyClaudeIdentityMetadata(body, { context: input.context, account: input.account, settings: settings });
		applyClaudeThinkingDisplay(body, model);
		signable = signing;
	} else if (systemBlocks.length > 0) {
		body["system"] = systemBlocks.map((block) => forwardedSystemBlock(block, true));
	}

	body["stream"] = input.context.stream;
	if (!explicitCache) {
		ensureCacheControl(body);
	}
	trimCacheControls(body, 4);
	delete body["prompt_cache_options"];
	dropEmptyMetadata(body);

	let raw: string | undefined;
	if (signable) {
		const serialized = JSON.stringify(body);
		raw = signClaudeCchBody(serialized, settings.cchHook ? { hook: settings.cchHook } : {});
	}
	return { body: body, signable: signable, raw: raw };
}

/**
 * 特化 count_tokens 请求体。
 *
 * count_tokens 不接受 metadata / context_management / diagnostics 等字段；Cloaking
 * 下也不发送 system：把调用方 system 内容搬进 messages，保证计数对象与实际请求一致。
 * @param input - 请求体上下文
 * @returns 特化后的请求体
 */
export function prepareClaudeCountTokensBody(input: ClaudeBodyInput): Record<string, unknown> {
	const body = cloneRecord(input.body);
	delete body["betas"];
	body["model"] = input.model;
	const cloaking = input.settings.cloaking !== false;
	normalizeClaudeMessages(body);
	normalizeClaudeTools(body);
	normalizeStopSequences(body);
	const systemBlocks = normalizeSystemBlocks(body["system"]);
	delete body["system"];
	if (cloaking && systemBlocks.length > 0) {
		if (CLAUDE_LEGACY_SYSTEM_REMINDER_MODELS.has(input.model.toLowerCase())) {
			prependSystemReminders(body, systemBlocks, true);
		} else {
			insertMidConversationSystem(body, systemBlocks, true);
		}
	} else if (!cloaking && systemBlocks.length > 0) {
		body["system"] = systemBlocks.map((block) => forwardedSystemBlock(block, true));
	}
	delete body["metadata"];
	delete body["context_management"];
	delete body["diagnostics"];
	delete body["stream"];
	delete body["output_config"];
	trimCacheControls(body, 4);
	return body;
}

/**
 * 把 Responses compact 请求转换为 Messages 摘要请求。
 *
 * 只覆盖 Responses input 的常见条目：message / function_call / function_call_output /
 * custom_tool_call / 压缩胶囊，以及 function 类型 tools；无法映射的条目被丢弃。
 * @param body - Responses compact 请求体
 * @param model - 上游模型
 * @returns Messages 摘要请求体
 */
export function buildClaudeCompactionRequest(body: Record<string, unknown>, model: string): Record<string, unknown> {
	const messages: Record<string, unknown>[] = [];
	const system: string[] = [];
	const instructions = textOf(body["instructions"]);
	if (instructions) {
		system.push(instructions);
	}
	const tools = compactionTools(body["tools"]);
	// 没有工具定义时，孤立的 tool_use / tool_result 会被 Anthropic 拒绝，因此拍平成文本。
	const flattenTools = tools.length === 0;
	const input = body["input"];
	if (typeof input === "string" && input.trim()) {
		messages.push({ role: "user", content: [{ type: "text", text: input }] });
	} else if (Array.isArray(input)) {
		for (const item of input) {
			const record = recordOf(item);
			if (record) {
				appendCompactionInput(messages, system, record, flattenTools);
			}
		}
	}
	messages.push({ role: "user", content: [{ type: "text", text: CLAUDE_COMPACTION_SUMMARY_PROMPT }] });
	const request: Record<string, unknown> = {
		model: model,
		max_tokens: claudeDefaultMaxTokens(model, {}),
		messages: mergeConsecutiveMessages(messages),
	};
	if (system.length > 0) {
		request["system"] = system.map((text) => ({ type: "text", text: text }));
	}
	if (tools.length > 0) {
		request["tools"] = tools;
		request["tool_choice"] = { type: "none" };
	}
	return request;
}

/**
 * 把 Messages 摘要响应转换为 Responses 压缩结果。
 * @param body - Messages 响应
 * @param model - 上游模型
 * @returns Responses compaction 响应
 * @throws Error 摘要响应缺少文本内容时抛出
 */
export function buildClaudeCompactionResponse(body: Record<string, unknown>, model: string): Record<string, unknown> {
	const summary = claudeResponseText(body);
	if (!summary) {
		throw new Error("摘要响应缺少文本内容");
	}
	const usage = recordOf(body["usage"]) ?? {};
	const inputTokens = numberOrZero(usage["input_tokens"]);
	const outputTokens = numberOrZero(usage["output_tokens"]);
	return {
		object: "response.compaction",
		id: `cmp_${randomUUID().replace(/-/g, "")}`,
		created_at: Math.floor(Date.now() / 1000),
		model: model,
		output: [{ type: "compaction", id: `cmp_ag_compact_${randomUUID().replace(/-/g, "")}`, encrypted_content: sealCompactionCapsule(summary, model) }],
		usage: {
			input_tokens: inputTokens,
			output_tokens: outputTokens,
			total_tokens: inputTokens + outputTokens,
		},
	};
}

/**
 * 读取 Messages 响应中的文本。
 * @param body - Messages 响应
 * @returns 文本内容
 */
export function claudeResponseText(body: Record<string, unknown>): string {
	const content = body["content"];
	if (!Array.isArray(content)) {
		return "";
	}
	const parts: string[] = [];
	for (const block of content) {
		const record = recordOf(block);
		if (!record || textOf(record["type"]) !== "text") {
			continue;
		}
		const text = textOf(record["text"]);
		if (text) {
			parts.push(text);
		}
	}
	return parts.join("\n\n");
}

/**
 * 解析 Claude 会话 ID。
 *
 * 优先使用调用方显式会话头；否则把桥接会话键稳定映射为 UUIDv5，保证同一会话在
 * 多轮请求中保持一致。
 * @param context - 请求上下文
 * @param account - 账号
 * @param settings - 适配器设置
 * @returns UUID 字符串
 */
export function resolveClaudeSessionId(
	context: SubscriptionRequestContext,
	account: SubscriptionAccount,
	settings: ClaudeRequestSettings,
): string {
	const custom = settings.sessionId?.(context);
	if (custom) {
		return custom;
	}
	for (const name of ["x-claude-code-session-id", "x-session-id", "x-conversation-id", "x-litellm-session"]) {
		const value = headerValue(context.headers, name);
		if (value && isUuid(value)) {
			return value.toLowerCase();
		}
	}
	const identity = context.sessionKey || context.model || account.id;
	return uuidV5(`cli-proxy-api\u0000claude\u0000agent-conversation\u0000${identity}`);
}

/**
 * 解析 Claude 设备 ID（64 位小写十六进制）。
 * @param account - 账号
 * @param settings - 适配器设置
 * @returns 设备 ID
 */
export function resolveClaudeDeviceId(account: SubscriptionAccount, settings: ClaudeRequestSettings): string {
	const configured = settings.deviceId?.trim();
	if (configured && /^[0-9a-f]{64}$/.test(configured)) {
		return configured;
	}
	const stored = account.raw["device_id"];
	if (typeof stored === "string" && /^[0-9a-f]{64}$/.test(stored.trim())) {
		return stored.trim();
	}
	return createHash("sha256").update(`claude-device\u0000${account.id}`).digest("hex");
}

/**
 * 解析账号 UUID。
 * @param account - 账号
 * @param settings - 适配器设置
 * @returns UUID 字符串
 */
export function resolveClaudeAccountUuid(account: SubscriptionAccount, settings: ClaudeRequestSettings): string {
	const configured = settings.accountUuid?.trim();
	if (configured) {
		return configured;
	}
	for (const key of ["account_uuid", "accountUuid", "organization_uuid"]) {
		const value = textOf(account.raw[key]);
		if (value && isUuid(value)) {
			return value.toLowerCase();
		}
	}
	return uuidV5(`cli-proxy-api\u0000claude\u0000account\u0000${account.id}`);
}

/**
 * 根据模型名里的 thinking 后缀补 thinking 配置。
 *
 * `claude-sonnet-4-5(8192)` 这类后缀来自调用方；已有 `thinking` 字段时不覆盖。
 * @param body - 请求体
 * @param requestedModel - 调用方模型（可能带后缀）
 */
function applyThinkingSuffix(body: Record<string, unknown>, requestedModel: string): void {
	if (body["thinking"] !== undefined) {
		return;
	}
	const suffix = parseThinkingSuffix(requestedModel);
	if (!suffix) {
		return;
	}
	if (suffix === "0" || suffix.toLowerCase() === "none" || suffix.toLowerCase() === "off") {
		body["thinking"] = { type: "disabled" };
		return;
	}
	const numeric = Number(suffix);
	if (Number.isFinite(numeric) && numeric > 0) {
		if (modelSupportsBudgetThinking(requestedModel)) {
			body["thinking"] = { type: "enabled", budget_tokens: Math.max(1024, Math.floor(numeric)) };
		} else {
			body["thinking"] = { type: "adaptive" };
		}
		return;
	}
	const level = suffix.toLowerCase();
	if (modelSupportsLevelThinking(requestedModel)) {
		body["thinking"] = { type: "adaptive" };
		const outputConfig = recordOf(body["output_config"]) ?? {};
		outputConfig["effort"] = level === "xhigh" ? "xhigh" : level;
		body["output_config"] = outputConfig;
	}
}

/**
 * 解析模型名末尾的 thinking 后缀。
 * @param model - 模型名
 * @returns 后缀内容；没有后缀时 undefined
 */
function parseThinkingSuffix(model: string): string | undefined {
	const open = model.lastIndexOf("(");
	if (open < 0 || !model.endsWith(")")) {
		return undefined;
	}
	const suffix = model.slice(open + 1, -1).trim();
	return suffix || undefined;
}

/**
 * 剥掉模型名里的 thinking 后缀。
 * @param model - 模型名
 * @returns 不含后缀的模型名
 */
export function stripClaudeThinkingSuffix(model: string): string {
	const open = model.lastIndexOf("(");
	return open >= 0 && model.endsWith(")") ? model.slice(0, open) : model;
}

/**
 * 判断模型是否支持 budget thinking（目录里有 min/max）。
 * @param model - 模型
 */
function modelSupportsBudgetThinking(model: string): boolean {
	return claudeThinkingMetadata(model)?.["min"] !== undefined;
}

/**
 * 判断模型是否支持 thinking levels。
 * @param model - 模型
 */
function modelSupportsLevelThinking(model: string): boolean {
	const levels = claudeThinkingMetadata(model)?.["levels"];
	return Array.isArray(levels);
}

/**
 * 读取目录里的 thinking 元数据。
 * @param model - 模型
 */
function claudeThinkingMetadata(model: string): Record<string, unknown> | undefined {
	const base = stripClaudeThinkingSuffix(model).toLowerCase();
	const entry = catalogForSource("claude").find((candidate) => candidate.id === base);
	return recordOf(entry?.metadata?.["thinking"]);
}

/**
 * 在 preserved-thinking 模型上补 block_binding，避免前缀变化导致 400。
 * @param body - 请求体
 * @param model - 上游模型
 */
function applyPreservedThinkingBinding(body: Record<string, unknown>, model: string): void {
	const normalized = model.toLowerCase();
	if (!usesPreservedThinking(normalized) || toolChoiceForcesToolUse(body) || !hasSignedThinking(body)) {
		return;
	}
	const thinking = recordOf(body["thinking"]);
	if (!thinking) {
		body["thinking"] = {
			type: "adaptive",
			block_binding: { prefix_mismatch_behavior: "drop_block" },
		};
		return;
	}
	const type = textOf(thinking["type"])?.toLowerCase();
	const acceptsBinding = type === "adaptive" || (type === "enabled" && !isHaiku55(normalized) && !isSonnet55(normalized));
	if (!acceptsBinding || recordOf(thinking["block_binding"])) {
		return;
	}
	thinking["block_binding"] = { prefix_mismatch_behavior: "drop_block" };
}

/**
 * 为交互式模型补 thinking.display=updates。
 * @param body - 请求体
 * @param model - 上游模型
 */
function applyClaudeThinkingDisplay(body: Record<string, unknown>, model: string): void {
	const normalized = model.toLowerCase();
	if (!(isOpus55(normalized) || isFable51(normalized) || isSonnet5(normalized) || isSonnet55(normalized))) {
		return;
	}
	const thinking = recordOf(body["thinking"]);
	if (!thinking || thinking["display"] !== undefined) {
		return;
	}
	const type = textOf(thinking["type"])?.toLowerCase();
	if (type === "adaptive" || type === "enabled") {
		thinking["display"] = "updates";
	}
}

/**
 * 判断模型是否要求 preserved-thinking block_binding。
 * @param model - 上游模型
 */
function usesPreservedThinking(model: string): boolean {
	return isOpus55(model) || isSonnet55(model) || isHaiku55(model) || isFable51(model);
}

/**
 * 判断 tool_choice 是否强制工具调用。
 * @param body - 请求体
 */
function toolChoiceForcesToolUse(body: Record<string, unknown>): boolean {
	const type = textOf(recordOf(body["tool_choice"])?.["type"]);
	return type === "any" || type === "tool";
}

/**
 * 写入 metadata.user_id 身份。
 * @param body - 请求体
 * @param input - 账号与上下文
 */
function applyClaudeIdentityMetadata(
	body: Record<string, unknown>,
	input: { readonly context: SubscriptionRequestContext; readonly account: SubscriptionAccount; readonly settings: ClaudeRequestSettings },
): void {
	const metadata = recordOf(body["metadata"]) ?? {};
	const existing = typeof metadata["user_id"] === "string" ? metadata["user_id"] : undefined;
	const extras: Record<string, unknown> = {};
	if (existing) {
		try {
			const parsed = recordOf(JSON.parse(existing) as unknown);
			if (parsed) {
				for (const [key, value] of Object.entries(parsed)) {
					if (key !== "device_id" && key !== "account_uuid" && key !== "session_id") {
						extras[key] = value;
					}
				}
			}
		} catch {
			// 非 JSON 的旧值直接丢弃，避免污染新身份。
		}
	}
	metadata["user_id"] = JSON.stringify({
		device_id: resolveClaudeDeviceId(input.account, input.settings),
		account_uuid: resolveClaudeAccountUuid(input.account, input.settings),
		session_id: resolveClaudeSessionId(input.context, input.account, input.settings),
		...extras,
	});
	body["metadata"] = metadata;
}

/**
 * 规范 system 字段为文本块数组。
 * @param value - 原始 system
 * @returns 文本块
 */
function normalizeSystemBlocks(value: unknown): ClaudeSystemBlock[] {
	const result: ClaudeSystemBlock[] = [];
	if (typeof value === "string") {
		if (value.trim()) {
			result.push({ text: value });
		}
		return result;
	}
	if (!Array.isArray(value)) {
		return result;
	}
	for (const block of value) {
		const record = recordOf(block);
		if (!record) {
			continue;
		}
		const type = textOf(record["type"]);
		if (type !== undefined && type !== "text") {
			continue;
		}
		const text = typeof record["text"] === "string" ? record["text"] : "";
		if (!text.trim()) {
			continue;
		}
		const cacheControl = recordOf(record["cache_control"]);
		result.push(cacheControl ? { text: text, cacheControl: cacheControl } : { text: text });
	}
	return result;
}

/**
 * 构造转发用 system 块。
 * @param block - 文本与 cache_control
 * @param explicitCache - 是否保留调用方 cache_control
 */
function forwardedSystemBlock(block: ClaudeSystemBlock, explicitCache: boolean): Record<string, unknown> {
	if (block.cacheControl) {
		// 调用方显式给了 cache_control：保留其内容（含 ttl），不再叠加默认断点。
		return { type: "text", text: block.text, cache_control: block.cacheControl };
	}
	if (explicitCache) {
		return { type: "text", text: block.text };
	}
	return { type: "text", text: block.text, cache_control: { type: "ephemeral" } };
}

/**
 * 读取首条用户消息文本，用于计费指纹。
 * @param body - 请求体
 */
function firstUserMessageText(body: Record<string, unknown>): string {
	const messages = body["messages"];
	if (!Array.isArray(messages)) {
		return "";
	}
	for (const message of messages) {
		const record = recordOf(message);
		if (!record || record["role"] !== "user") {
			continue;
		}
		const content = record["content"];
		if (typeof content === "string") {
			return content;
		}
		if (Array.isArray(content)) {
			for (const block of content) {
				const blockRecord = recordOf(block);
				if (blockRecord && blockRecord["type"] === "text" && typeof blockRecord["text"] === "string") {
					return blockRecord["text"];
				}
			}
		}
	}
	return "";
}

/**
 * 在首条用户消息前插入 `<system-reminder>` 块（旧模型路径）。
 * @param body - 请求体
 * @param blocks - system 文本块
 * @param explicitCache - 是否保留显式 cache_control
 */
function prependSystemReminders(body: Record<string, unknown>, blocks: readonly ClaudeSystemBlock[], explicitCache: boolean): void {
	const messages = body["messages"];
	if (!Array.isArray(messages)) {
		return;
	}
	const index = messages.findIndex((message) => recordOf(message)?.["role"] === "user");
	if (index < 0) {
		return;
	}
	const message = recordOf(messages[index]);
	if (!message) {
		return;
	}
	const content = message["content"];
	const additions = blocks.map((block) => systemReminderBlock(block, explicitCache));
	if (typeof content === "string") {
		message["content"] = [...additions, { type: "text", text: content }];
		return;
	}
	if (!Array.isArray(content)) {
		return;
	}
	const existing = new Set(
		content
			.map((block) => recordOf(block))
			.filter((block): block is Record<string, unknown> => block !== undefined && block["type"] === "text")
			.map((block) => String(block["text"] ?? "")),
	);
	let insertAt = 0;
	while (insertAt < content.length && recordOf(content[insertAt])?.["type"] === "tool_result") {
		insertAt += 1;
	}
	const unique = additions.filter((block) => !existing.has(String(block["text"])));
	content.splice(insertAt, 0, ...unique);
}

/**
 * 构造 `<system-reminder>` 文本块。
 * @param block - system 文本块
 * @param explicitCache - 是否保留显式 cache_control
 */
function systemReminderBlock(block: ClaudeSystemBlock, explicitCache: boolean): Record<string, unknown> {
	const wrapped = `<system-reminder>\n${block.text}${block.text.endsWith("\n") ? "" : "\n"}</system-reminder>`;
	if (explicitCache && block.cacheControl) {
		return { type: "text", text: wrapped, cache_control: block.cacheControl };
	}
	return { type: "text", text: wrapped, cache_control: { type: "ephemeral" } };
}

/**
 * 把 system 块作为 mid-conversation system 消息插入。
 * @param body - 请求体
 * @param blocks - system 文本块
 * @param explicitCache - 是否保留显式 cache_control
 * @returns 是否插入成功
 */
function insertMidConversationSystem(body: Record<string, unknown>, blocks: readonly ClaudeSystemBlock[], explicitCache: boolean): boolean {
	const messages = body["messages"];
	if (!Array.isArray(messages)) {
		return false;
	}
	const firstUser = messages.findIndex((message) => recordOf(message)?.["role"] === "user");
	if (firstUser < 0) {
		return false;
	}
	let insertAt = firstUser + 1;
	while (insertAt < messages.length && recordOf(messages[insertAt])?.["role"] === "user") {
		insertAt += 1;
	}
	const inserted = blocks.map((block) => ({
		role: "system",
		content: [forwardedSystemBlock(block, explicitCache)],
	}));
	messages.splice(insertAt, 0, ...inserted);
	return true;
}

/**
 * 在 tool_choice 强制工具调用时关闭 thinking。
 * @param body - 请求体
 */
function disableThinkingWhenToolChoiceForced(body: Record<string, unknown>): void {
	if (!toolChoiceForcesToolUse(body)) {
		return;
	}
	delete body["thinking"];
	const outputConfig = recordOf(body["output_config"]);
	if (outputConfig) {
		delete outputConfig["effort"];
		if (Object.keys(outputConfig).length === 0) {
			delete body["output_config"];
		}
	}
}

/**
 * 校正 sampling 参数，使其满足 Anthropic 组合约束。
 * @param body - 请求体
 */
function normalizeClaudeSampling(body: Record<string, unknown>): void {
	const thinkingType = textOf(recordOf(body["thinking"])?.["type"])?.toLowerCase();
	const thinkingActive = thinkingType === "enabled" || thinkingType === "adaptive";
	if (thinkingActive) {
		if (body["temperature"] !== undefined && body["temperature"] !== 1) {
			delete body["temperature"];
		}
		const topP = body["top_p"];
		if (typeof topP !== "number" || !Number.isFinite(topP) || topP < 0.95) {
			delete body["top_p"];
		}
		delete body["top_k"];
		return;
	}
	if (body["temperature"] !== undefined && body["top_p"] !== undefined) {
		delete body["top_p"];
	}
}

/**
 * 归一化消息块。
 * @param body - 请求体
 */
function normalizeClaudeMessages(body: Record<string, unknown>): void {
	const messages = body["messages"];
	if (!Array.isArray(messages)) {
		return;
	}
	const normalized: Record<string, unknown>[] = [];
	for (const message of messages) {
		const record = recordOf(message);
		if (!record) {
			continue;
		}
		const role = textOf(record["role"]);
		if (!role) {
			continue;
		}
		const blocks = normalizeMessageContent(record["content"]);
		if (blocks.length === 0) {
			continue;
		}
		normalized.push({ ...record, role: role, content: blocks });
	}
	body["messages"] = normalized;
}

/**
 * 归一化单条消息的 content。
 * @param content - 原始 content
 * @returns 块数组
 */
function normalizeMessageContent(content: unknown): Record<string, unknown>[] {
	if (typeof content === "string") {
		return content.trim() ? [{ type: "text", text: content }] : [];
	}
	if (!Array.isArray(content)) {
		return [];
	}
	const blocks: Record<string, unknown>[] = [];
	for (const block of content) {
		const record = recordOf(block);
		if (!record) {
			continue;
		}
		const type = textOf(record["type"]);
		switch (type) {
			case "text":
				if (typeof record["text"] === "string" && record["text"].trim()) {
					blocks.push({ ...record });
				}
				break;
			case "tool_use":
				blocks.push({ ...record, input: recordOf(record["input"]) ?? {} });
				break;
			case "tool_result": {
				const next: Record<string, unknown> = { ...record };
				if (next["content"] === undefined || next["content"] === null) {
					next["content"] = "";
				}
				blocks.push(next);
				break;
			}
			case "thinking":
			case "redacted_thinking":
				if (record["thinking"] !== undefined || record["data"] !== undefined || record["signature"] !== undefined) {
					blocks.push({ ...record });
				}
				break;
			default:
				if (type) {
					blocks.push({ ...record });
				}
				break;
		}
	}
	return blocks;
}

/**
 * 归一化工具定义。
 * @param body - 请求体
 */
function normalizeClaudeTools(body: Record<string, unknown>): void {
	const tools = body["tools"];
	if (!Array.isArray(tools)) {
		return;
	}
	const normalized: Record<string, unknown>[] = [];
	for (const tool of tools) {
		const record = recordOf(tool);
		if (!record) {
			continue;
		}
		const next: Record<string, unknown> = { ...record };
		const schema = recordOf(next["input_schema"]);
		if (schema && schema["type"] === undefined) {
			next["input_schema"] = { ...schema, type: "object" };
		}
		normalized.push(next);
	}
	body["tools"] = normalized;
}

/**
 * 归一化 stop_sequences。
 * @param body - 请求体
 */
function normalizeStopSequences(body: Record<string, unknown>): void {
	const value = body["stop_sequences"];
	if (typeof value === "string") {
		body["stop_sequences"] = [value];
		return;
	}
	if (!Array.isArray(value)) {
		return;
	}
	const sequences = value.filter((item): item is string => typeof item === "string" && item.length > 0);
	if (sequences.length > 0) {
		body["stop_sequences"] = sequences;
		return;
	}
	delete body["stop_sequences"];
}

/**
 * 补默认 cache_control 断点：system 尾块、tools 尾项、最新用户消息尾块。
 * @param body - 请求体
 */
function ensureCacheControl(body: Record<string, unknown>): void {
	if (countCacheControls(body) > 0) {
		return;
	}
	const ephemeral = { type: "ephemeral" };
	const system = body["system"];
	if (Array.isArray(system) && system.length > 0) {
		const last = recordOf(system[system.length - 1]);
		if (last && last["cache_control"] === undefined) {
			last["cache_control"] = { ...ephemeral };
			return;
		}
	}
	const tools = body["tools"];
	if (Array.isArray(tools) && tools.length > 0) {
		const last = recordOf(tools[tools.length - 1]);
		if (last && last["cache_control"] === undefined) {
			last["cache_control"] = { ...ephemeral };
			return;
		}
	}
	const messages = body["messages"];
	if (!Array.isArray(messages)) {
		return;
	}
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = recordOf(messages[index]);
		if (!message) {
			continue;
		}
		const content = message["content"];
		if (typeof content === "string") {
			if (content.trim()) {
				message["content"] = [{ type: "text", text: content, cache_control: { ...ephemeral } }];
				return;
			}
			continue;
		}
		if (!Array.isArray(content) || content.length === 0) {
			continue;
		}
		const last = recordOf(content[content.length - 1]);
		if (last && last["type"] !== "thinking" && last["type"] !== "redacted_thinking" && last["cache_control"] === undefined) {
			last["cache_control"] = { ...ephemeral };
			return;
		}
	}
}

/**
 * 统计 cache_control 断点数量。
 * @param body - 请求体
 */
function countCacheControls(body: Record<string, unknown>): number {
	let count = 0;
	for (const section of ["system", "tools"]) {
		const items = body[section];
		if (!Array.isArray(items)) {
			continue;
		}
		for (const item of items) {
			if (isCacheControl(recordOf(item)?.["cache_control"])) {
				count += 1;
			}
		}
	}
	const messages = body["messages"];
	if (Array.isArray(messages)) {
		for (const message of messages) {
			const content = recordOf(message)?.["content"];
			if (!Array.isArray(content)) {
				continue;
			}
			for (const block of content) {
				if (isCacheControl(recordOf(block)?.["cache_control"])) {
					count += 1;
				}
			}
		}
	}
	return count;
}

/**
 * 把 cache_control 断点裁剪到上限，优先保留消息内的断点。
 * @param body - 请求体
 * @param limit - 最大断点数
 */
function trimCacheControls(body: Record<string, unknown>, limit: number): void {
	const systemPaths: Record<string, unknown>[] = [];
	const toolPaths: Record<string, unknown>[] = [];
	const messagePaths: Record<string, unknown>[] = [];
	for (const section of ["system", "tools"]) {
		const items = body[section];
		if (!Array.isArray(items)) {
			continue;
		}
		for (const item of items) {
			const record = recordOf(item);
			if (record && isCacheControl(record["cache_control"])) {
				(section === "system" ? systemPaths : toolPaths).push(record);
			}
		}
	}
	const messages = body["messages"];
	if (Array.isArray(messages)) {
		for (const message of messages) {
			const content = recordOf(message)?.["content"];
			if (!Array.isArray(content)) {
				continue;
			}
			for (const block of content) {
				const record = recordOf(block);
				if (record && isCacheControl(record["cache_control"])) {
					messagePaths.push(record);
				}
			}
		}
	}
	let excess = systemPaths.length + toolPaths.length + messagePaths.length - limit;
	if (excess <= 0) {
		return;
	}
	// 与 Go 一致：先清掉 system / tools 里除最后一个之外的断点，再从最早的消息断点删起。
	while (excess > 0 && systemPaths.length > 1) {
		delete systemPaths.shift()?.["cache_control"];
		excess -= 1;
	}
	while (excess > 0 && toolPaths.length > 1) {
		delete toolPaths.shift()?.["cache_control"];
		excess -= 1;
	}
	while (excess > 0 && messagePaths.length > 0) {
		delete messagePaths.shift()?.["cache_control"];
		excess -= 1;
	}
	while (excess > 0 && systemPaths.length > 0) {
		delete systemPaths.shift()?.["cache_control"];
		excess -= 1;
	}
	while (excess > 0 && toolPaths.length > 0) {
		delete toolPaths.shift()?.["cache_control"];
		excess -= 1;
	}
}

/**
 * 判断值是否合法 cache_control。
 * @param value - 待判定值
 */
function isCacheControl(value: unknown): boolean {
	const record = recordOf(value);
	return record !== undefined && typeof record["type"] === "string";
}

/**
 * 判断请求体是否已声明 thinking.display。
 * @param body - 请求体
 */
function thinkingDisplaySet(body: Record<string, unknown>): boolean {
	return recordOf(body["thinking"])?.["display"] !== undefined;
}

/**
 * 判断 thinking.display 是否为 updates。
 * @param body - 请求体
 */
function thinkingDisplayUpdates(body: Record<string, unknown>): boolean {
	const display = recordOf(body["thinking"])?.["display"];
	return typeof display === "string" && display.toLowerCase() === "updates";
}

/**
 * 判断是否存在 1 小时 cache_control。
 * @param body - 请求体
 */
function hasOneHourCacheControl(body: Record<string, unknown>): boolean {
	return JSON.stringify(body).includes('"ttl":"1h"');
}

/**
 * 判断请求体是否要求 evict_on_complete。
 * @param body - 请求体
 */
function containsEvictOption(body: Record<string, unknown>): boolean {
	return JSON.stringify(body).includes("evict_on_complete");
}

/**
 * 判断模型名是否带 1M 上下文标记。
 * @param requested - 调用方模型（可能带 `[1m]`）
 * @param upstream - 上游模型
 */
function modelHasOneMillionContext(requested: string, upstream: string): boolean {
	return requested.toLowerCase().includes("[1m]") || upstream.toLowerCase().includes("[1m]");
}

/**
 * 是否 Opus 5.5 系列。
 * @param model - 模型
 */
function isOpus55(model: string): boolean {
	return model === "claude-opus-5-5" || model.startsWith("claude-opus-5-5[");
}

/**
 * 是否 Sonnet 5.5 系列。
 * @param model - 模型
 */
function isSonnet55(model: string): boolean {
	return model === "claude-sonnet-5-5" || model.startsWith("claude-sonnet-5-5-") || model.startsWith("claude-sonnet-5-5[");
}

/**
 * 是否 Sonnet 5 系列（不含 5.5）。
 * @param model - 模型
 */
function isSonnet5(model: string): boolean {
	if (isSonnet55(model)) {
		return false;
	}
	return model === "claude-sonnet-5" || model.startsWith("claude-sonnet-5-") || model.startsWith("claude-sonnet-5[");
}

/**
 * 是否 Haiku 5.5 系列。
 * @param model - 模型
 */
function isHaiku55(model: string): boolean {
	return model === "claude-haiku-5-5" || model.startsWith("claude-haiku-5-5-") || model.startsWith("claude-haiku-5-5[");
}

/**
 * 是否 Fable 5.1 / Mythos 5.1。
 * @param model - 模型
 */
function isFable51(model: string): boolean {
	return (
		model.includes("fable-5-1") || model.includes("fable-5.1") || model.includes("mythos-5-1") || model.includes("mythos-5.1")
	);
}

/**
 * 判断历史里是否有 advisor 工具调用/结果。
 * @param body - 请求体
 */
function hasAdvisorHistory(body: Record<string, unknown>): boolean {
	const messages = body["messages"];
	if (!Array.isArray(messages)) {
		return false;
	}
	for (const message of messages) {
		const content = recordOf(message)?.["content"];
		if (!Array.isArray(content)) {
			continue;
		}
		for (const block of content) {
			const record = recordOf(block);
			const type = textOf(record?.["type"]);
			if (type === "advisor_tool_result" || type === "advisor_redacted_result") {
				return true;
			}
			if (type === "server_tool_use" && record?.["name"] === "advisor") {
				return true;
			}
		}
	}
	return false;
}

/**
 * 清空空的 metadata 对象。
 * @param body - 请求体
 */
function dropEmptyMetadata(body: Record<string, unknown>): void {
	const metadata = recordOf(body["metadata"]);
	if (metadata && Object.keys(metadata).length === 0) {
		delete body["metadata"];
	}
}

/**
 * 判断消息历史里是否有带签名的 thinking 块。
 * @param body - 请求体
 */
function hasSignedThinking(body: Record<string, unknown>): boolean {
	const messages = body["messages"];
	if (!Array.isArray(messages)) {
		return false;
	}
	for (const message of messages) {
		const content = recordOf(message)?.["content"];
		if (!Array.isArray(content)) {
			continue;
		}
		for (const block of content) {
			const record = recordOf(block);
			const type = textOf(record?.["type"]);
			if (type === "thinking" && textOf(record?.["signature"])) {
				return true;
			}
			if (type === "redacted_thinking" && textOf(record?.["data"])) {
				return true;
			}
		}
	}
	return false;
}

/**
 * 读取请求头。
 * @param headers - 请求头
 * @param name - 头名
 */
function headerValue(headers: Record<string, string>, name: string): string | undefined {
	const lowered = name.toLowerCase();
	for (const [key, value] of Object.entries(headers)) {
		if (key.toLowerCase() === lowered && value.trim()) {
			return value.trim();
		}
	}
	return undefined;
}

/**
 * 拆分逗号分隔的 beta 列表。
 * @param value - 原始值
 */
function splitBetas(value: unknown): string[] {
	if (typeof value === "string") {
		return value
			.split(",")
			.map((item) => item.trim())
			.filter(Boolean);
	}
	if (Array.isArray(value)) {
		return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
	}
	return [];
}

/**
 * 是否为 UUID。
 * @param value - 待判定值
 */
function isUuid(value: string): boolean {
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** UUIDv5 命名空间：OID。 */
const UUID_NAMESPACE_OID = "6ba7b812-9dad-11d1-80b4-00c04fd430c8";

/**
 * 生成 UUIDv5。
 * @param name - 名称
 */
function uuidV5(name: string): string {
	const namespace = Buffer.from(UUID_NAMESPACE_OID.replace(/-/g, ""), "hex");
	const hash = createHash("sha1").update(namespace).update(Buffer.from(name, "utf8")).digest();
	const bytes = Buffer.from(hash.subarray(0, 16));
	bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
	bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * 深拷贝 JSON 记录。
 * @param value - 原始对象
 */
function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
	return cloneJson(value) as Record<string, unknown>;
}

/**
 * 深拷贝 JSON 值。
 * @param value - 原始值
 */
function cloneJson(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map((item) => cloneJson(item));
	}
	const record = recordOf(value);
	if (!record) {
		return value;
	}
	const result: Record<string, unknown> = {};
	for (const [key, item] of Object.entries(record)) {
		result[key] = cloneJson(item);
	}
	return result;
}

/**
 * 断言普通对象。
 * @param value - 待判定值
 */
function recordOf(value: unknown): Record<string, unknown> | undefined {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/**
 * 读取非空字符串。
 * @param value - 待判定值
 */
function textOf(value: unknown): string | undefined {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/**
 * 读取数字，缺省 0。
 * @param value - 待判定值
 */
function numberOrZero(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * 把一条 Responses input 条目追加到 Messages 请求。
 * @param messages - 输出消息
 * @param system - 输出 system 文本
 * @param item - Responses 条目
 * @param flattenTools - 是否把工具块拍平为文本
 */
function appendCompactionInput(
	messages: Record<string, unknown>[],
	system: string[],
	item: Record<string, unknown>,
	flattenTools: boolean,
): void {
	const type = textOf(item["type"]) ?? "message";
	if (type === "compaction_trigger" || type === "additional_tools") {
		return;
	}
	if (type === "compaction") {
		const capsule = textOf(item["encrypted_content"]);
		if (capsule) {
			try {
				const summary = unsealCompactionCapsule(capsule);
				messages.push({ role: "user", content: [{ type: "text", text: `Context summary from previous turns:\n${summary}` }] });
			} catch {
				// 无法解封的胶囊直接略过，摘要仍覆盖其余历史。
			}
		}
		return;
	}
	if (type === "function_call" || type === "custom_tool_call") {
		const callId = textOf(item["call_id"]) ?? textOf(item["id"]) ?? `call_${randomUUID().replace(/-/g, "")}`;
		const name = textOf(item["name"]) ?? "tool";
		let input: Record<string, unknown> = {};
		if (type === "custom_tool_call") {
			input = { input: textOf(item["input"]) ?? "" };
		} else {
			const args = item["arguments"];
			if (typeof args === "string") {
				try {
					input = recordOf(JSON.parse(args) as unknown) ?? { value: args };
				} catch {
					input = { value: args };
				}
			} else if (recordOf(args)) {
				input = recordOf(args) as Record<string, unknown>;
			}
		}
		if (flattenTools) {
			messages.push({ role: "assistant", content: [{ type: "text", text: `Tool call ${name} (${callId}): ${JSON.stringify(input)}` }] });
			return;
		}
		messages.push({ role: "assistant", content: [{ type: "tool_use", id: callId, name: name, input: input }] });
		return;
	}
	if (type === "function_call_output" || type === "custom_tool_call_output") {
		const output = compactionToolOutput(item["output"]);
		if (flattenTools) {
			messages.push({ role: "user", content: [{ type: "text", text: `Tool result ${textOf(item["call_id"]) ?? ""}: ${output}` }] });
			return;
		}
		messages.push({
			role: "user",
			content: [{ type: "tool_result", tool_use_id: textOf(item["call_id"]) ?? "", content: output }],
		});
		return;
	}
	if (type === "reasoning") {
		return;
	}
	const role = textOf(item["role"]) ?? "user";
	const text = responsesContentText(item["content"]);
	if (!text) {
		return;
	}
	if (role === "system" || role === "developer") {
		system.push(text);
		return;
	}
	messages.push({ role: role === "assistant" ? "assistant" : "user", content: [{ type: "text", text: text }] });
}

/**
 * 提取 Responses content 文本。
 * @param content - content
 */
function responsesContentText(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}
	const parts: string[] = [];
	for (const block of content) {
		const record = recordOf(block);
		if (!record) {
			continue;
		}
		const text = textOf(record["text"]);
		if (text) {
			parts.push(text);
		}
	}
	return parts.join("\n");
}

/**
 * 提取工具输出文本。
 * @param output - Responses 工具输出
 */
function compactionToolOutput(output: unknown): string {
	if (typeof output === "string") {
		return output;
	}
	if (Array.isArray(output)) {
		return output.map((item) => compactionToolOutput(item)).filter(Boolean).join("\n");
	}
	const record = recordOf(output);
	if (!record) {
		return "";
	}
	return textOf(record["text"]) ?? textOf(record["content"]) ?? JSON.stringify(record);
}

/**
 * 合并连续同角色消息。
 * @param messages - 消息列表
 * @returns 合并后的消息
 */
function mergeConsecutiveMessages(messages: Record<string, unknown>[]): Record<string, unknown>[] {
	const merged: Record<string, unknown>[] = [];
	for (const message of messages) {
		const previous = merged[merged.length - 1];
		if (previous && previous["role"] === message["role"] && Array.isArray(previous["content"]) && Array.isArray(message["content"])) {
			(previous["content"] as unknown[]).push(...(message["content"] as unknown[]));
			continue;
		}
		merged.push(message);
	}
	return merged;
}

/**
 * 转换 Responses tools 为 Anthropic tools。
 * @param value - Responses tools
 */
function compactionTools(value: unknown): Record<string, unknown>[] {
	if (!Array.isArray(value)) {
		return [];
	}
	const tools: Record<string, unknown>[] = [];
	for (const tool of value) {
		const record = recordOf(tool);
		if (!record) {
			continue;
		}
		if ((textOf(record["type"]) ?? "function") !== "function") {
			continue;
		}
		const name = textOf(record["name"]);
		if (!name) {
			continue;
		}
		const parameters = recordOf(record["parameters"]);
		tools.push({
			name: name,
			description: textOf(record["description"]) ?? "",
			input_schema: parameters ? { ...parameters, type: parameters["type"] ?? "object" } : { type: "object", properties: {} },
		});
	}
	return tools;
}

/**
 * 用 AES-256-GCM 封装压缩摘要。
 * @param summary - 摘要文本
 * @param model - 上游模型
 * @returns 胶囊字符串
 */
function sealCompactionCapsule(summary: string, model: string): string {
	const key = createHash("sha256").update("CLIProxyAPI").digest();
	const nonce = randomBytes(12);
	const cipher = createCipheriv("aes-256-gcm", key, nonce);
	const plaintext = JSON.stringify({ summary: summary, model: model, created_at: Math.floor(Date.now() / 1000) });
	const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
	const tag = cipher.getAuthTag();
	return `${CLAUDE_COMPACTION_CAPSULE_PREFIX}${Buffer.concat([nonce, encrypted, tag]).toString("base64url")}`;
}

/**
 * 解封压缩摘要胶囊。
 * @param capsule - 胶囊字符串
 * @returns 摘要文本
 * @throws Error 胶囊格式或密钥校验失败时抛出
 */
function unsealCompactionCapsule(capsule: string): string {
	if (!capsule.startsWith(CLAUDE_COMPACTION_CAPSULE_PREFIX)) {
		throw new Error("无法识别的压缩胶囊");
	}
	const raw = Buffer.from(capsule.slice(CLAUDE_COMPACTION_CAPSULE_PREFIX.length), "base64url");
	if (raw.length < 12 + 16) {
		throw new Error("压缩胶囊长度不足");
	}
	const key = createHash("sha256").update("CLIProxyAPI").digest();
	const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
	decipher.setAuthTag(raw.subarray(raw.length - 16));
	const plaintext = Buffer.concat([decipher.update(raw.subarray(12, raw.length - 16)), decipher.final()]).toString("utf8");
	const parsed = recordOf(JSON.parse(plaintext) as unknown);
	const summary = parsed ? textOf(parsed["summary"]) : undefined;
	if (!summary) {
		throw new Error("压缩胶囊缺少摘要");
	}
	return summary;
}
