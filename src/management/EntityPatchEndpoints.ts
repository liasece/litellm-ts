import type { Router, Request } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import type { DrizzleDb } from "../core/db/Database";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError } from "../core/api/ApiError";
import { jsonMergePatch } from "../core/utils/jsonMergePatch";
import { LiteLLM_TeamTable } from "../db/schema/teams";
import { LiteLLM_OrganizationTable } from "../db/schema/organizations";
import { LiteLLM_BudgetTable } from "../db/schema/budgets";

const nonnegative = z.number().finite().nonnegative().nullable();
const common = {
	metadata: z.record(z.unknown()).nullable().optional(),
	models: z.array(z.string()).optional(),
	max_budget: nonnegative.optional(),
	soft_budget: nonnegative.optional(),
	tpm_limit: nonnegative.optional(),
	rpm_limit: nonnegative.optional(),
	max_parallel_requests: nonnegative.optional(),
	budget_duration: z.string().nullable().optional(),
};
const teamPatchSchema = z
	.object({
		...common,
		team_id: z.string().optional(),
		team_alias: z.string().nullable().optional(),
		organization_id: z.string().nullable().optional(),
		admins: z.array(z.string()).optional(),
		members: z.array(z.string()).optional(),
		blocked: z.boolean().optional(),
	})
	.strict();
const orgPatchSchema = z
	.object({
		...common,
		organization_id: z.string().optional(),
		organization_alias: z.string().min(1).optional(),
		model_max_budget: z.record(z.number().finite().nonnegative()).nullable().optional(),
	})
	.strict();
const teamColumns: Record<string, string> = {
	team_alias: "teamAlias",
	organization_id: "organizationId",
	admins: "admins",
	members: "members",
	blocked: "blocked",
	models: "models",
	max_budget: "maxBudget",
	soft_budget: "softBudget",
	tpm_limit: "tpmLimit",
	rpm_limit: "rpmLimit",
	max_parallel_requests: "maxParallelRequests",
	budget_duration: "budgetDuration",
};

function assertAdmin(req: Request): void {
	if (req.auth?.user_role !== "proxy_admin") {
		throw ApiError.forbidden("Management endpoint requires proxy admin access");
	}
}
function parsePatch<T>(schema: z.ZodType<T>, body: unknown): T {
	const result = schema.safeParse(body);
	if (!result.success) {
		throw ApiError.badRequest(result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
	}
	return result.data;
}
function projectColumns(body: Record<string, unknown>, mapping: Record<string, string>): Record<string, unknown> {
	return Object.fromEntries(Object.entries(mapping).flatMap(([key, column]) => (key in body ? [[column, body[key]]] : [])));
}
function snakeCaseRow(row: Record<string, unknown>): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(row).map(([key, value]) => [key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`), value]),
	);
}

/**
 * @param router
 * @param db
 */
export function registerEntityPatchRoutes(router: Router, db: DrizzleDb): void {
	registerRoute(router, { method: "patch", path: "/team/:team_id" }, async (req) => {
		assertAdmin(req);
		const body = parsePatch(teamPatchSchema, req.body);
		const id = String(req.params.team_id);
		if (body.team_id !== undefined && body.team_id !== id) {
			throw ApiError.badRequest("team_id does not match path");
		}
		return db.transaction(async (tx) => {
			const [existing] = await tx.select().from(LiteLLM_TeamTable).where(eq(LiteLLM_TeamTable.teamId, id)).for("update");
			if (!existing) {
				throw ApiError.notFound("Team not found");
			}
			const fields = projectColumns(body, teamColumns);
			if ("metadata" in body) {
				fields["metadata"] = jsonMergePatch(existing.metadata, body.metadata) ?? {};
			}
			const [updated] = await tx
				.update(LiteLLM_TeamTable)
				.set({ ...fields, updatedAt: new Date() })
				.where(eq(LiteLLM_TeamTable.teamId, id))
				.returning();
			return snakeCaseRow(updated as unknown as Record<string, unknown>);
		});
	});
	registerRoute(router, { method: "patch", path: "/v2/organization/:organization_id" }, async (req) => {
		assertAdmin(req);
		const body = parsePatch(orgPatchSchema, req.body);
		const id = String(req.params.organization_id);
		if (body.organization_id !== undefined && body.organization_id !== id) {
			throw ApiError.badRequest("organization_id does not match path");
		}
		return db.transaction(async (tx) => {
			const [existing] = await tx
				.select()
				.from(LiteLLM_OrganizationTable)
				.where(eq(LiteLLM_OrganizationTable.organizationId, id))
				.for("update");
			if (!existing) {
				throw ApiError.notFound("Organization not found");
			}
			const orgFields = projectColumns(body, { organization_alias: "organizationAlias", models: "models" });
			if ("metadata" in body) {
				orgFields["metadata"] = body.metadata ?? {};
			}
			const budgetFields = projectColumns(
				body,
				Object.fromEntries(
					[
						"max_budget",
						"soft_budget",
						"tpm_limit",
						"rpm_limit",
						"max_parallel_requests",
						"model_max_budget",
						"budget_duration",
					].map((key) => [key, key]),
				),
			);
			if (Object.keys(budgetFields).length) {
				const budgets = await tx
					.update(LiteLLM_BudgetTable)
					.set({ ...budgetFields, updated_at: new Date(), updated_by: req.auth!.user_id ?? "proxy-admin" })
					.where(eq(LiteLLM_BudgetTable.budget_id, existing.budgetId))
					.returning();
				if (!budgets.length) {
					throw ApiError.notFound("Organization budget not found");
				}
			}
			const [updated] = await tx
				.update(LiteLLM_OrganizationTable)
				.set({ ...orgFields, updatedAt: new Date(), updatedBy: req.auth!.user_id ?? "proxy-admin" })
				.where(eq(LiteLLM_OrganizationTable.organizationId, id))
				.returning();
			const [budget] = await tx.select().from(LiteLLM_BudgetTable).where(eq(LiteLLM_BudgetTable.budget_id, existing.budgetId));
			return { ...snakeCaseRow(updated as unknown as Record<string, unknown>), litellm_budget_table: budget ?? null };
		});
	});
}
