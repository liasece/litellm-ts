import express from "express";
import request from "supertest";
import { createTeamRoutes } from "./TeamEndpoint";
import { LiteLLM_TeamTable } from "../db/schema/teams";
import { LiteLLM_UserTable } from "../db/schema/users";
import { LiteLLM_TeamMembership } from "../db/schema/team-memberships";

function makeApp(): express.Express {
	const app = express();
	app.use(express.json());
	const router = express.Router();
	const teamRow = { teamId: "team-a", models: [], admins: [], members: [], blocked: false };
	const userRow = { userId: "u1", userEmail: null, userRole: null, models: [], metadata: {} };
	const membershipRow = { userId: "u1", teamId: "team-a", spend: 0, budgetId: null };
	const db = {
		select: () => ({
			from: (table: unknown) => {
				const rows =
					table === LiteLLM_TeamTable
						? [teamRow]
						: table === LiteLLM_UserTable
							? [userRow]
							: table === LiteLLM_TeamMembership
								? [membershipRow]
								: [];
				return {
					where: () => ({
						limit: () => Promise.resolve(rows),
					}),
				};
			},
		}),
		insert: () => ({
			values: () => ({
				onConflictDoNothing: () => Promise.resolve(),
				returning: () => Promise.resolve([userRow]),
			}),
		}),
		delete: () => ({
			where: () => Promise.resolve({ rowCount: 1 }),
		}),
	};
	createTeamRoutes(router, db as never, null);
	app.use(router);
	return app;
}

describe("TeamEndpoint Python member path aliases", () => {
	it("POST /team/member_add returns Python-compatible TeamAddMemberResponse", async () => {
		const res = await request(makeApp()).post("/team/member_add").send({ team_id: "team-a", user_id: "u1" });

		expect(res.status).toBe(200);
		expect(res.body.team_id).toBe("team-a");
		expect(res.body.updated_users).toEqual(expect.arrayContaining([expect.objectContaining({ userId: "u1" })]));
		expect(res.body.updated_team_memberships).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					user_id: "u1",
					team_id: "team-a",
				}),
			]),
		);
	});

	it("POST /team/member_delete returns deleted membership", async () => {
		const res = await request(makeApp()).post("/team/member_delete").send({ team_id: "team-a", user_id: "u1" });

		expect(res.status).toBe(200);
		expect(res.body).toEqual(
			expect.objectContaining({
				userId: "u1",
				teamId: "team-a",
			}),
		);
	});
});

describe("TeamEndpoint 写操作响应 Python 契约", () => {
	const TEAM_ROW = {
		teamId: "team-1",
		teamAlias: "alias-t",
		organizationId: null,
		objectPermissionId: null,
		admins: [],
		members: [],
		membersWithRoles: [{ user_id: "default_user_id", user_email: null, role: "admin" }],
		metadata: {},
		maxBudget: 8,
		softBudget: null,
		spend: 0,
		models: [],
		maxParallelRequests: null,
		tpmLimit: null,
		rpmLimit: null,
		budgetDuration: null,
		budgetResetAt: null,
		blocked: false,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		updatedAt: new Date("2026-01-02T00:00:00.000Z"),
		modelSpend: {},
		modelMaxBudget: {},
		routerSettings: {},
		teamMemberPermissions: [],
		accessGroupIds: [],
		policies: [],
		modelId: null,
		allowTeamGuardrailConfig: false,
	};

	const TEAM_INFO_FIELDS = [
		"team_alias",
		"team_id",
		"organization_id",
		"admins",
		"members",
		"members_with_roles",
		"team_member_permissions",
		"metadata",
		"tpm_limit",
		"rpm_limit",
		"max_budget",
		"soft_budget",
		"budget_duration",
		"models",
		"blocked",
		"router_settings",
		"access_group_ids",
		"spend",
		"max_parallel_requests",
		"budget_reset_at",
		"model_id",
		"litellm_model_table",
		"object_permission",
		"updated_at",
		"created_at",
		"object_permission_id",
	];

	const TEAM_UPDATE_DATA_EXTRA_FIELDS = [
		"model_spend",
		"model_max_budget",
		"policies",
		"allow_team_guardrail_config",
		"litellm_organization_table",
		"projects",
	];

	function makeCrudApp(): express.Express {
		const app = express();
		app.use(express.json());
		const router = express.Router();
		const db = {
			select: () => ({
				from: (table: unknown) => {
					const rows = table === LiteLLM_TeamTable ? [TEAM_ROW] : [];
					return {
						where: () => {
							const promise = Promise.resolve(rows) as Promise<unknown[]> & { limit: (n: number) => Promise<unknown[]> };
							promise.limit = (n: number) => Promise.resolve(rows.slice(0, n));
							return promise;
						},
					};
				},
			}),
			insert: () => ({
				values: () => ({
					onConflictDoNothing: () => Promise.resolve(),
					returning: () => Promise.resolve([TEAM_ROW]),
				}),
			}),
			update: () => ({
				set: () => ({
					where: () => ({
						returning: () => Promise.resolve([TEAM_ROW]),
					}),
				}),
			}),
			delete: () => ({
				where: () => Promise.resolve({ rowCount: 1 }),
			}),
		};
		createTeamRoutes(router, db as never, null);
		app.use(router);
		return app;
	}

	it("/team/new 返回 26 键完整 team 对象（无 success 包装）", async () => {
		const res = await request(makeCrudApp()).post("/team/new").send({ team_alias: "alias-t", max_budget: 8 });

		expect(res.status).toBe(200);
		expect(res.body.success).toBeUndefined();
		expect(Object.keys(res.body).sort()).toEqual([...TEAM_INFO_FIELDS].sort());
		expect(res.body.team_id).toBe("team-1");
		expect(res.body.members_with_roles).toEqual([{ user_id: "default_user_id", user_email: null, role: "admin" }]);
	});

	it("/team/update 返回 { team_id, data: 32 键 team 对象 }", async () => {
		const res = await request(makeCrudApp()).post("/team/update").send({ team_id: "team-1", max_budget: 8 });

		expect(res.status).toBe(200);
		expect(res.body.team_id).toBe("team-1");
		expect(Object.keys(res.body.data).sort()).toEqual([...TEAM_INFO_FIELDS, ...TEAM_UPDATE_DATA_EXTRA_FIELDS].sort());
		expect(res.body.data.max_budget).toBe(8);
		expect(res.body.data.projects).toBeNull();
	});

	it("/team/delete 接受 team_ids 并返回 { deleted_teams }", async () => {
		const app = makeCrudApp();

		const res = await request(app)
			.post("/team/delete")
			.send({ team_ids: ["team-1"] });
		expect(res.status).toBe(200);
		expect(res.body).toEqual({ deleted_teams: ["team-1"] });

		const missing = await request(app).post("/team/delete").send({});
		expect(missing.status).toBe(400);
	});

	it("/team/info 返回 { team_id, team_info(27 键), keys, team_memberships }", async () => {
		const res = await request(makeCrudApp()).get("/team/info?team_id=team-1");

		expect(res.status).toBe(200);
		expect(res.body.team_id).toBe("team-1");
		expect(Object.keys(res.body.team_info).sort()).toEqual([...TEAM_INFO_FIELDS, "team_member_budget_table"].sort());
		expect(res.body.team_info.team_member_budget_table).toBeNull();
		expect(res.body.keys).toEqual([]);
		expect(res.body.team_memberships).toEqual([]);
	});
});
