import { z } from "zod";
import type { AccessOrganization, AccessTeam, AccessUser, TeamDetail } from "../support/AccessModels";
export const recordSchema = z.record(z.string(), z.unknown());
const strings = z
	.array(z.string())
	.nullish()
	.transform((value) => value ?? []);
const records = z
	.array(recordSchema)
	.nullish()
	.transform((value) => value ?? []);
const memberSchema = z
	.object({
		user_id: z.string().nullish(),
		user_email: z.string().nullish(),
		role: z.string().optional(),
		user_role: z.string().optional(),
	})
	.passthrough()
	.transform((value) => ({ ...value, role: value.role ?? value.user_role ?? "" }));
export const budgetSchema = z.object({ budget_id: z.string() }).passthrough();
export const teamSchema = z
	.object({
		team_id: z.string(),
		models: strings,
		members_with_roles: z
			.array(memberSchema)
			.nullish()
			.transform((value) => value ?? []),
		keys: records,
	})
	.passthrough();
export const organizationSchema = z
	.object({
		organization_id: z.string(),
		organization_alias: z.string(),
		models: strings,
		members: z
			.array(memberSchema)
			.nullish()
			.transform((value) => value ?? []),
		litellm_budget_table: budgetSchema,
	})
	.passthrough();
export const userSchema = z.object({ user_id: z.string(), models: strings }).passthrough();
export const parseTeams = (value: unknown): AccessTeam[] => z.array(teamSchema).parse(value) as AccessTeam[];
export const parseTeam = (value: unknown): TeamDetail =>
	z
		.object({ team_id: z.string(), team_info: teamSchema, keys: records, team_memberships: records })
		.passthrough()
		.parse(value) as TeamDetail;
export const parseOrganizations = (value: unknown): AccessOrganization[] =>
	z.array(organizationSchema).parse(value) as AccessOrganization[];
export const parseOrganization = (value: unknown): AccessOrganization => organizationSchema.parse(value) as AccessOrganization;
export const parseUsers = (value: unknown): AccessUser[] => z.array(userSchema).parse(value) as AccessUser[];
export const parseUser = (value: unknown): AccessUser => userSchema.parse(value) as AccessUser;
