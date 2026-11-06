import { describe, expect, it } from "vitest";
import { areSameStaticLogFields, isEntryInProgress, readLiveDetailValues } from "./liveDetail";
import type { LogEntry } from "../columns";

const MESSAGES = [{ role: "user", content: "hello" }];
const METADATA = { status: "in_progress" };
const PROXY_SERVER_REQUEST = { url: "/v1/chat/completions", method: "POST", body: { model: "gpt-4" } };
const REQUEST_TAGS = {};

/**
 * 构造进行中的日志条目。静态字段复用同一份常量引用，
 * 与生产一致：推送帧只覆盖变化字段，未变化的引用保持不变。
 * @param overrides - 需要覆盖的字段
 */
const createEntry = (overrides: Partial<LogEntry> = {}): LogEntry =>
	({
		request_id: "req-streaming",
		api_key: "api-key",
		team_id: "team-id",
		model: "gpt-4",
		model_id: "gpt-4",
		call_type: "chat",
		spend: 0,
		total_tokens: 0,
		prompt_tokens: 0,
		completion_tokens: 0,
		startTime: "2025-11-14T00:00:00Z",
		endTime: "2025-11-14T00:00:01Z",
		cache_hit: "miss",
		messages: MESSAGES,
		response: undefined,
		metadata: METADATA,
		proxy_server_request: PROXY_SERVER_REQUEST,
		request_tags: REQUEST_TAGS,
		custom_llm_provider: "openai",
		status: "in_progress",
		...overrides,
	}) as LogEntry;

describe("readLiveDetailValues", () => {
	it("暴露当前响应与指标，供详情页的流式区域使用", () => {
		const values = readLiveDetailValues(
			createEntry({
				response: { choices: [{ message: { content: "第一段" } }] },
				prompt_tokens: 11,
				completion_tokens: 12,
				total_tokens: 23,
				request_duration_ms: 735,
				completionStartTime: "2025-11-14T00:00:00.180Z",
			}),
		);

		expect(values.response).toEqual({ choices: [{ message: { content: "第一段" } }] });
		expect(values.metrics.completion_tokens).toBe(12);
		expect(values.metrics.request_duration_ms).toBe(735);
		expect(values.metrics.completionStartTime).toBe("2025-11-14T00:00:00.180Z");
	});

	it("没有条目时返回空响应，不抛错", () => {
		expect(readLiveDetailValues(null).response).toBeUndefined();
	});
});

describe("areSameStaticLogFields", () => {
	it("只有响应/token/耗时变化时判定为同一静态内容", () => {
		const before = createEntry();
		const after = createEntry({
			response: { choices: [{ message: { content: "hi" } }] },
			prompt_tokens: 11,
			completion_tokens: 12,
			total_tokens: 23,
			request_duration_ms: 735,
			endTime: "2025-11-14T00:00:02Z",
			completionStartTime: "2025-11-14T00:00:00.180Z",
		});

		expect(areSameStaticLogFields(before, after)).toBe(true);
	});

	it("静态字段变化时判定为不同内容，详情页不会停在旧值", () => {
		const before = createEntry();
		expect(areSameStaticLogFields(before, createEntry({ model_id: "gpt-4-0613" }))).toBe(false);
		expect(areSameStaticLogFields(before, createEntry({ messages: [{ role: "user", content: "other" }] }))).toBe(false);
		expect(
			areSameStaticLogFields(before, createEntry({ metadata: { status: "in_progress", model_resolution_chain: [] } })),
		).toBe(false);
	});
});

describe("isEntryInProgress", () => {
	it("识别集合状态与 metadata 状态为进行中", () => {
		expect(isEntryInProgress(createEntry())).toBe(true);
		expect(isEntryInProgress(createEntry({ status: "success", metadata: { status: "in_progress" } }))).toBe(true);
		expect(isEntryInProgress(createEntry({ status: "success", metadata: { status: "success" } }))).toBe(false);
		expect(isEntryInProgress(null)).toBe(false);
	});
});
