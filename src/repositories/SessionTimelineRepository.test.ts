import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { DrizzleDb } from "../core/db/Database";
import { SessionTimelineRepository } from "./SessionTimelineRepository";

/**
 * 时间线读取的语句形态。
 *
 * 时间线的成本几乎全在两处 SQL 结构上：窗口扫描只读体积、payload 只按选中序号取块。
 * 一旦有人把它们改回「整段读取再过滤」，长会话会立刻退回上 GB 的 detoast，而功能测试
 * 仍然全绿。这里固定住这两个结构。
 */
describe("SessionTimelineRepository", () => {
	const dialect = new PgDialect();

	it("窗口扫描按压缩体积切窗，不展开消息内容", async () => {
		let selection: Record<string, unknown> = {};
		const db = {
			select: (projection: Record<string, unknown>) => {
				selection = projection;
				const chain = {
					from: () => chain,
					where: () => chain,
					orderBy: () => chain,
					limit: () => Promise.resolve([]),
				};
				return chain;
			},
		};
		await new SessionTimelineRepository(db as unknown as DrizzleDb).listWindowScanRows(sql`TRUE`, "desc", 51);

		// 引用列表只读写入侧记录的逻辑字节数；内联行退回 pg_column_size（同样不解压）。
		const bytesQuery = dialect.sqlToQuery(selection["messages_bytes"] as SQL);
		expect(bytesQuery.sql).toContain("pg_column_size");
		expect(bytesQuery.params).toEqual(expect.arrayContaining(["_litellm_ref_messages", "_litellm_ref_bytes"]));
		expect(bytesQuery.sql).not.toContain("jsonb_array_elements");
	});

	it("payload 只按选中序号取块，并 join 块表", async () => {
		let selection: Record<string, unknown> = {};
		const db = {
			select: (projection: Record<string, unknown>) => {
				selection = projection;
				const chain = {
					from: () => chain,
					where: () => Promise.resolve([]),
				};
				return chain;
			},
		};
		await new SessionTimelineRepository(db as unknown as DrizzleDb).listPayloadRows(sql`TRUE`, JSON.stringify({ "req-1": [0, 2] }));
		const query = dialect.sqlToQuery(selection["request_payload"] as SQL);

		expect(query.sql).toContain("LiteLLM_SpendLogBlocks");
		expect(query.sql).toContain("@> to_jsonb");
		expect(query.sql).toContain("jsonb_array_elements_text");
		// 选中序号随请求传入，SQL 文本里不内联具体序号，参数化后才能复用执行计划。
		expect(query.params).toEqual(expect.arrayContaining(['{"req-1":[0,2]}']));
	});
});
