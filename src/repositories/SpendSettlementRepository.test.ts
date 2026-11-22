import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { DrizzleDb } from "../core/db/Database";
import { SpendSettlementRepository } from "./SpendSettlementRepository";

/**
 * 结算主体累加的语句形态。
 *
 * 结算延迟由「一次往返」决定：主体再多也只能发一条 `WITH` 语句。这条用例固定住该形态，
 * 避免以后有人为了可读性把它拆成逐主体 UPDATE，把往返次数重新叠回结算事务。
 */
describe("SpendSettlementRepository", () => {
	function capture(): { tx: { execute: jest.Mock }; statements: string[] } {
		const statements: string[] = [];
		const tx = {
			execute: jest.fn((statement: unknown) => {
				statements.push(new PgDialect().sqlToQuery(statement as SQL).sql);
				return Promise.resolve({ rows: [] });
			}),
		};
		return { tx: tx, statements: statements };
	}

	it("全部主体合并成一条 WITH 语句", async () => {
		const { tx, statements } = capture();
		const repository = new SpendSettlementRepository(tx as unknown as DrizzleDb);
		await repository.accumulateSubjectSpend(tx as never, {
			token: "hashed-key",
			spend: 0.5,
			userId: "user-1",
			teamId: "team-1",
			organizationId: "org-1",
			projectId: "project-1",
			endUserId: "end-user-1",
		});

		expect(tx.execute).toHaveBeenCalledTimes(1);
		expect(statements).toHaveLength(1);
		const statement = statements[0]!;
		for (const table of [
			"LiteLLM_VerificationToken",
			"LiteLLM_UserTable",
			"LiteLLM_TeamTable",
			"LiteLLM_OrganizationTable",
			"LiteLLM_ProjectTable",
			"LiteLLM_TeamMembership",
			"LiteLLM_EndUserTable",
		]) {
			expect(statement).toContain(table);
		}
		// 同一笔 spend 在每个主体上都是「NULL 兼容累加」，不能把缺失值当 0 直接赋值。
		expect(statement.match(/COALESCE/g)).toHaveLength(7);
	});

	it("缺省主体不生成空更新，语句仍只有一条", async () => {
		const { tx, statements } = capture();
		const repository = new SpendSettlementRepository(tx as unknown as DrizzleDb);
		await repository.accumulateSubjectSpend(tx as never, { token: "hashed-key", spend: 0 });

		expect(tx.execute).toHaveBeenCalledTimes(1);
		const statement = statements[0]!;
		expect(statement).toContain("LiteLLM_VerificationToken");
		expect(statement).not.toContain("LiteLLM_UserTable");
		expect(statement).not.toContain("LiteLLM_TeamMembership");
	});
});
