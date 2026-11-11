import { sql } from "drizzle-orm";
import { liteLLM_ActiveRequests } from "../db/schema/activeRequests";
import { encodeActiveRequestPayload } from "./SpendLogBlocks";
import { readInProgressSessionRows, type SessionTimelineScope } from "./sessionTimelineLive";

const scope: SessionTimelineScope = {
	groupKey: "s:session-1",
	includeAuxiliary: false,
	visibilityClause: sql`TRUE`,
	activeVisibilityClause: sql`TRUE`,
};

/** 链式查询替身：在途行查询终于 `orderBy`，块查询终于 `where`。 */
function createDb(activeRows: readonly Record<string, unknown>[], blockRows: readonly Record<string, unknown>[]) {
	const activeChain = {
		orderBy: () => Promise.resolve(activeRows),
		limit: () => Promise.resolve(activeRows),
		where: () => activeChain,
	};
	return {
		select: jest.fn(() => ({
			from: jest.fn((table: unknown) => {
				if (table === liteLLM_ActiveRequests) {
					return activeChain;
				}
				const blockChain = {
					where: () => Promise.resolve(blockRows),
					orderBy: () => Promise.resolve(blockRows),
				};
				return blockChain;
			}),
		})),
	};
}

describe("readInProgressSessionRows", () => {
	it("把在途行的块引用组装回请求体后再分类，进行中与结算后的展示一致", async () => {
		const tools = [{ name: "litellm__image_create", description: "生成图片", input_schema: { type: "object" } }];
		const system = [{ type: "text", text: "You are Claude Code." }, { type: "text", text: "工具说明" }];
		const body = {
			model: "claude",
			system: system,
			tools: tools,
			messages: [
				{ role: "user", content: "第一问" },
				{ role: "assistant", content: "第一答" },
				{ role: "user", content: "追问" },
			],
		};
		const encoded = encodeActiveRequestPayload({ url: "/v1/messages", method: "POST", headers: {}, body: body });
		const blockRows = encoded.blocks.map((block) => ({ blockId: block.blockId, payload: block.payload }));
		const db = createDb(
			[
				{
					request_id: "req-live",
					call_type: "acompletion",
					api_key: "key-id",
					startTime: new Date("2026-01-01T00:00:10.000Z"),
					model: "claude",
					metadata: { status: "in_progress", user_api_key_alias: "alias-1" },
					proxy_server_request: encoded.proxyServerRequest,
					completion_start_time: null,
					updated_at: new Date("2026-01-01T00:00:20.000Z"),
				},
			],
			blockRows,
		);

		const rows = await readInProgressSessionRows(db as never, scope);

		expect(rows).toHaveLength(1);
		const row = rows[0]!;
		// 对话、工具与 system 都按原样回到时间线负载里，客户端看不到内部引用键。
		expect(JSON.stringify(row.request_payload)).not.toContain("_litellm_ref_");
		expect(((row.request_payload as Record<string, unknown>)["body"] as Record<string, unknown>)["messages"]).toEqual(body.messages);
		// 分类投影取自组装后的正文，和结算后由 SQL 投影的结果一致。
		expect(row.request_tool_count).toBe(1);
		expect(row.request_first_tool_name).toBe("litellm__image_create");
		expect(row.request_system_count).toBe(2);
		expect(row.request_message_count).toBe(3);
		expect(row.request_first_system_prompt).toBe("You are Claude Code.");
	});
});
