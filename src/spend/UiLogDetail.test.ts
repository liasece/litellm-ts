import { liteLLM_ActiveRequests } from "../db/schema/activeRequests";
import { encodeActiveRequestPayload } from "./SpendLogBlocks";
import { buildActiveRequestDetail } from "./UiLogDetail";
import { publishLiveResponse, registerLiveResponse, resetLiveResponseRegistry } from "./LiveResponseRegistry";

/** 链式查询替身：既能被 await（块查询），也能 .limit()（在途行查询）。 */
function selectChain(rows: readonly unknown[]) {
	const result = {
		where: () => result,
		orderBy: () => result,
		limit: () => Promise.resolve(rows),
		then: (resolve: (value: readonly unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
			Promise.resolve(rows).then(resolve, reject),
		catch: (reject: (reason: unknown) => unknown) => Promise.resolve(rows).catch(reject),
		finally: (callback: () => void) => Promise.resolve(rows).finally(callback),
	};
	return result;
}

/**
 * @param activeRow - 在途行
 * @param blockRows - 块表内容
 */
function createDb(activeRow: Record<string, unknown>, blockRows: readonly Record<string, unknown>[]) {
	return {
		select: jest.fn(() => ({
			from: jest.fn((table: unknown) =>
				table === liteLLM_ActiveRequests ? selectChain([activeRow]) : selectChain(blockRows),
			),
		})),
	};
}

describe("buildActiveRequestDetail", () => {
	afterEach(() => {
		resetLiveResponseRegistry();
	});

	it("内存实时快照优先于数据库里的 checkpoint", async () => {
		const db = createDb(
			{
				request_id: "req-mem",
				call_type: "aresponses",
				startTime: new Date("2026-01-01T00:00:00.000Z"),
				model: "gpt",
				model_id: null,
				model_group: null,
				custom_llm_provider: null,
				api_base: null,
				user: null,
				team_id: null,
				organization_id: null,
				end_user: null,
				requester_ip_address: null,
				session_id: null,
				request_tags: [],
				completion_start_time: null,
				proxy_server_request: { url: "/v1/responses", method: "POST", headers: {}, body: { model: "gpt" } },
				metadata: {
					status: "in_progress",
					streaming_execution: { response: { text: "来自数据库" }, usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
				},
				request_duration_ms: 10,
			},
			[],
		);
		registerLiveResponse("req-mem", () => ({
			response: { text: "来自内存" },
			usage: { prompt_tokens: 5, completion_tokens: 7, total_tokens: 12 },
		}));

		const detail = await buildActiveRequestDetail(db as never, "req-mem");

		expect((detail?.["response"] as Record<string, unknown>)["text"]).toBe("来自内存");
		expect(detail?.["total_tokens"]).toBe(12);
	});

	it("把在途行的正文引用组装回完整请求体", async () => {
		const messages = [
			{ role: "user", content: [{ type: "text", text: "V".repeat(20_000) }] },
			{ role: "assistant", content: [{ type: "text", text: "收到" }] },
		];
		const encoded = encodeActiveRequestPayload({ url: "/v1/messages", method: "POST", headers: {}, body: { model: "claude", messages } });
		const blockRows = encoded.blocks.map((block) => ({
			blockId: block.blockId,
			payload: block.payload,
			byteSize: block.byteSize,
		}));
		const db = createDb(
			{
				request_id: "req-live",
				call_type: "acompletion",
				startTime: new Date("2026-01-01T00:00:00.000Z"),
				model: "claude",
				model_id: "deployment-1",
				model_group: "claude",
				custom_llm_provider: "anthropic",
				api_base: "https://api.example.com",
				user: "user-1",
				team_id: null,
				organization_id: null,
				end_user: null,
				requester_ip_address: null,
				session_id: "session-1",
				request_tags: [],
				completion_start_time: null,
				proxy_server_request: encoded.proxyServerRequest,
				metadata: { status: "in_progress" },
				request_duration_ms: 12,
			},
			blockRows,
		);

		const detail = await buildActiveRequestDetail(db as never, "req-live");

		expect(detail).not.toBeNull();
		expect(detail?.["status"]).toBe("in_progress");
		expect((detail?.["proxy_server_request"] as Record<string, unknown>)["body"]).toEqual({ model: "claude", messages });
		// 页面上不应看到内部引用键。
		expect(JSON.stringify(detail?.["proxy_server_request"])).not.toContain("_litellm_ref_");
	});

	it("checkpoint 里的上游字段仍覆盖在途行正文", async () => {
		const body = { model: "claude", messages: [{ role: "user", content: "hi" }] };
		const encoded = encodeActiveRequestPayload({ url: "/v1/messages", body });
		const blockRows = encoded.blocks.map((block) => ({
			blockId: block.blockId,
			payload: block.payload,
			byteSize: block.byteSize,
		}));
		const db = createDb(
			{
				request_id: "req-checkpoint",
				call_type: "acompletion",
				startTime: new Date("2026-01-01T00:00:00.000Z"),
				model: "claude",
				model_id: "deployment-1",
				model_group: "claude",
				custom_llm_provider: "anthropic",
				api_base: "https://api.example.com",
				user: "user-1",
				team_id: null,
				organization_id: null,
				end_user: null,
				requester_ip_address: null,
				session_id: "session-1",
				request_tags: [],
				completion_start_time: null,
				proxy_server_request: encoded.proxyServerRequest,
				// 升级前的行只有 checkpoint 里的上游字段。
				metadata: {
					status: "in_progress",
					streaming_execution: { upstream_request: { url: "https://api.example.com/v1/messages", body: { model: "claude" } } },
				},
				request_duration_ms: 12,
			},
			blockRows,
		);

		const detail = await buildActiveRequestDetail(db as never, "req-checkpoint");
		const proxyServerRequest = detail?.["proxy_server_request"] as Record<string, unknown>;

		expect((proxyServerRequest["body"] as Record<string, unknown>)["messages"]).toEqual(body.messages);
		expect((proxyServerRequest["upstream_request"] as Record<string, unknown>)["url"]).toBe(
			"https://api.example.com/v1/messages",
		);
	});
});
