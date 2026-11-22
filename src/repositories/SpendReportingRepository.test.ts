import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import type { DrizzleDb } from "../core/db/Database";
import { liteLLM_ActiveRequests } from "../db/schema/activeRequests";
import { liteLLM_SpendLogs } from "../db/schema/spendLogs";
import { SpendReportingRepository, type UiPageRowKey } from "./SpendReportingRepository";

/**
 * 报表读取的语句形态与回表兜底。
 *
 * 这两件事都只在边界时刻才起作用，普通端点测试很难碰到：
 *   - 会话 ID 走规范键精确匹配还是 LIKE 包含匹配，决定 All Time 下是全表扫还是走索引；
 *   - 分页键与回表之间正好跨过一次结算提交时，行落在另一张表里仍要出现在页面上。
 * 因此在这里固定住形态与兜底顺序。
 */
describe("SpendReportingRepository", () => {
	const dialect = new PgDialect();
	const repository = new SpendReportingRepository({} as unknown as DrizzleDb);

	it("完整会话 UUID 走规范键精确匹配，部分 ID 仍保留包含匹配", () => {
		const exact = dialect.sqlToQuery(repository.uiSpendLogsWhereClause({ sessionId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301" }) as SQL);
		expect(exact.sql).toContain(`"LiteLLM_SpendLogs"."session_group_key" in`);
		expect(exact.params).toEqual(
			expect.arrayContaining(["s:3f2504e0-4f89-41d3-9a0c-0305e82c3301", "c:3f2504e0-4f89-41d3-9a0c-0305e82c3301"]),
		);

		const partial = dialect.sqlToQuery(repository.uiSpendLogsWhereClause({ sessionId: "3f25" }) as SQL);
		expect(partial.sql).toContain("strpos");
		expect(partial.params).toEqual(expect.arrayContaining(["s:%", "c:%", "3f25"]));
	});

	it("success 过滤兼容历史 NULL 行", () => {
		const query = dialect.sqlToQuery(repository.uiSpendLogsWhereClause({ statusFilter: "success" }) as SQL);
		// 成功判定是 SQL 字面量：历史行 status 为 NULL 也算成功，不能只匹配 'success'。
		expect(query.sql).toContain(`= 'success'`);
		expect(query.sql).toContain("IS NULL");
	});

	it("回表时把跨提交的行从另一张表补齐，并按分页键顺序返回", async () => {
		const spendRows = [
			{ request_id: "settled", from: "spend" },
			{ request_id: "just-settled", from: "spend" },
		];
		const activeRows = [{ request_id: "running", from: "active" }];
		const db = {
			select: () => ({
				from: (table: unknown) => ({
					where: (predicate: unknown) => {
						const params = dialect.sqlToQuery(predicate as SQL).params;
						const rows = table === liteLLM_SpendLogs ? spendRows : activeRows;
						return Promise.resolve(rows.filter((row) => params.includes(row.request_id)));
					},
				}),
			}),
		};
		const keys: UiPageRowKey[] = [
			{ request_id: "running", source: "active" },
			{ request_id: "settled", source: "spend" },
			// 这条在 ActiveRequests 里已经消失（结算提交落在分页与回表之间），
			// 只有 SpendLogs 里还有；不去兜底这一页就会少一行。
			{ request_id: "just-settled", source: "active" },
			// 两张表都没有（并发删除），只能丢弃，不能占位。
			{ request_id: "gone", source: "spend" },
		];

		const rows = await new SpendReportingRepository(db as unknown as DrizzleDb).hydrateUiPageRows(keys);

		expect(rows.map((row) => row.request_id)).toEqual(["running", "settled", "just-settled"]);
		expect(rows.map((row) => row.from)).toEqual(["active", "spend", "spend"]);
	});

	it("会话分组计数把可见性条件 AND 进 where 并按会话键分组", async () => {
		let captured: SQL | undefined;
		const db = {
			select: () => ({
				from: () => ({
					where: (predicate: unknown) => {
						captured = predicate as SQL;
						return {
							groupBy: () => Promise.resolve([{ session_group_key: "s:abc", total: 3 }]),
						};
					},
				}),
			}),
		};
		const rows = await new SpendReportingRepository(db as unknown as DrizzleDb).countSpendLogsBySessionGroup(
			["s:abc"],
			sql`${liteLLM_SpendLogs.api_key} = ${"key-hash"}`,
		);

		expect(rows).toEqual([{ session_group_key: "s:abc", total: 3 }]);
		const query = dialect.sqlToQuery(captured as SQL);
		expect(query.sql).toContain(`"LiteLLM_SpendLogs"."session_group_key" in`);
		expect(query.params).toEqual(expect.arrayContaining(["s:abc", "key-hash"]));
	});
});
