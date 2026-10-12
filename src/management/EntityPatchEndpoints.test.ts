import express from "express";
import request from "supertest";
import type { DrizzleDb } from "../core/db/Database";
import { registerEntityPatchRoutes } from "./EntityPatchEndpoints";
import { LiteLLM_TeamTable } from "../db/schema/teams";
import { LiteLLM_OrganizationTable } from "../db/schema/organizations";
import { LiteLLM_BudgetTable } from "../db/schema/budgets";

function setup(role = "proxy_admin", budgetExists = true) {
	let team = { teamId: "t1", teamAlias: "original", metadata: { nested: { keep: 1, remove: 2 }, other: true }, models: ["a"] };
	let org = { organizationId: "o1", organizationAlias: "original", budgetId: "b1", models: ["a"], metadata: { old: true } };
	let budget = { budget_id: "b1", max_budget: 10, soft_budget: 5 };
	const select = () => ({
		from: (table: unknown) => ({
			where: () => {
				const rows =
					table === LiteLLM_TeamTable
						? [structuredClone(team)]
						: table === LiteLLM_OrganizationTable
							? [structuredClone(org)]
							: budgetExists
								? [structuredClone(budget)]
								: [];
				return Object.assign(Promise.resolve(rows), { for: () => Promise.resolve(rows) });
			},
		}),
	});
	const update = (table: unknown) => ({
		set: (fields: Record<string, unknown>) => ({
			where: () => ({
				returning: async () => {
					if (table === LiteLLM_TeamTable) {
						team = { ...team, ...fields };
						return [team];
					}
					if (table === LiteLLM_OrganizationTable) {
						org = { ...org, ...fields };
						return [org];
					}
					if (!budgetExists) return [];
					budget = { ...budget, ...fields };
					return [budget];
				},
			}),
		}),
	});
	const transaction = jest.fn(async (callback: (tx: unknown) => Promise<unknown>) => {
		const before = structuredClone({ team, org, budget });
		try {
			return await callback({ select, update });
		} catch (error) {
			team = before.team;
			org = before.org;
			budget = before.budget;
			throw error;
		}
	});
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		req.auth = { api_key: "test-key", user_id: "admin", user_role: role };
		next();
	});
	registerEntityPatchRoutes(app, { transaction } as unknown as DrizzleDb);
	return { app, transaction, state: () => ({ team, org, budget }) };
}

describe("transactional entity PATCH contracts", () => {
	it("merges team metadata while preserving omitted scalar fields", async () => {
		const fixture = setup();
		const response = await request(fixture.app)
			.patch("/team/t1")
			.send({ metadata: { nested: { remove: null, add: 3 } } });
		expect(response.status).toBe(200);
		expect(response.body.team_alias).toBe("original");
		expect(response.body.metadata).toEqual({ nested: { keep: 1, add: 3 }, other: true });
	});
	it("updates organization and budget in one transaction and rolls back missing budgets", async () => {
		const fixture = setup();
		const response = await request(fixture.app).patch("/v2/organization/o1").send({ max_budget: 20, metadata: null, models: [] });
		expect(response.status).toBe(200);
		expect(fixture.state().budget).toMatchObject({ max_budget: 20, soft_budget: 5 });
		expect(fixture.state().org.metadata).toEqual({});
		const missing = setup("proxy_admin", false);
		expect(
			(await request(missing.app).patch("/v2/organization/o1").send({ max_budget: 20, organization_alias: "changed" })).status,
		).toBe(404);
		expect(missing.state().org.organizationAlias).toBe("original");
	});
	it("rejects non-admins, mismatched identities, unsupported fields and invalid clear/budget values before writing", async () => {
		const member = setup("internal_user");
		expect((await request(member.app).patch("/team/t1").send({ team_alias: "changed" })).status).toBe(403);
		expect(member.transaction).not.toHaveBeenCalled();
		const fixture = setup();
		for (const body of [
			{ organization_id: "other" },
			{ models: null },
			{ organization_alias: null },
			{ max_budget: -1 },
			{ unknown: "field" },
		])
			expect((await request(fixture.app).patch("/v2/organization/o1").send(body)).status).toBe(400);
		expect(fixture.transaction).not.toHaveBeenCalled();
	});
});
