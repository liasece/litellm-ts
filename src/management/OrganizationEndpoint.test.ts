import express from "express";
import request from "supertest";
import { createOrganizationRoutes } from "./OrganizationEndpoint";
import { LiteLLM_OrganizationTable } from "../db/schema/organizations";
import { LiteLLM_UserTable } from "../db/schema/users";
import { LiteLLM_OrganizationMembership } from "../db/schema/organization-memberships";

function makeApp(): express.Express {
	const app = express();
	app.use(express.json());
	const router = express.Router();
	const organizationRow = {
		organizationId: "org-a",
		organizationAlias: "Org A",
		budgetId: "",
		metadata: {},
		models: [],
		spend: 0,
		createdBy: "admin",
		updatedBy: "admin",
	};
	const userRow = { userId: "u1", userEmail: null, userRole: null, models: [], metadata: {} };
	const membershipRow = {
		userId: "u1",
		organizationId: "org-a",
		userRole: null,
		spend: 0,
		budgetId: null,
		createdAt: null,
		updatedAt: null,
	};
	const db = {
		select: () => ({
			from: (table: unknown) => {
				const rows =
					table === LiteLLM_OrganizationTable
						? [organizationRow]
						: table === LiteLLM_UserTable
							? [userRow]
							: table === LiteLLM_OrganizationMembership
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
	createOrganizationRoutes(router, db as never, null);
	app.use(router);
	return app;
}

describe("OrganizationEndpoint Python member path aliases", () => {
	it("POST /organization/member_add returns Python-compatible response", async () => {
		const res = await request(makeApp()).post("/organization/member_add").send({ organization_id: "org-a", user_id: "u1" });

		expect(res.status).toBe(200);
		expect(res.body.organization_id).toBe("org-a");
		expect(res.body.updated_users).toEqual(expect.arrayContaining([expect.objectContaining({ userId: "u1" })]));
		expect(res.body.updated_organization_memberships).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					user_id: "u1",
					organization_id: "org-a",
				}),
			]),
		);
	});

	it("POST /organization/member_delete returns deleted membership", async () => {
		const res = await request(makeApp()).post("/organization/member_delete").send({ organization_id: "org-a", user_id: "u1" });

		expect(res.status).toBe(200);
		expect(res.body).toEqual(
			expect.objectContaining({
				user_id: "u1",
				organization_id: "org-a",
			}),
		);
	});
});
