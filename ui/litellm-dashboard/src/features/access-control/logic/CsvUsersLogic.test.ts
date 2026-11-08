import { describe, expect, it } from "vitest";
import { parseCsv, parseCsvUsers, csvUserPayload, encodeCsv } from "./CsvUsersLogic";
import type { AccessTeam } from "../support/AccessModels";
describe("Bulk account invitations CSV", () => {
	it("round-trips commas, multiline cells and escaped quotes rather than splitting inside quoted fields", () => {
		const rows = [
			["user_email", "models", "metadata"],
			["person@example.test", "model-a,model-b", '{"label":"first\nsecond"}'],
		];
		expect(parseCsv(encodeCsv(rows))).toEqual(rows);
		expect(parseCsv('a,b\r\n"quoted ""value""",c')).toEqual([
			["a", "b"],
			['quoted "value"', "c"],
		]);
	});
	it("rejects missing columns before any users can be submitted and reports per-row validation errors", () => {
		expect(parseCsvUsers("email\nuser@example.test", []).structureError).toContain("user_email, user_role");
		const result = parseCsvUsers(
			"user_email,user_role,teams,max_budget,budget_duration\nvalid@example.test,internal_user,team-a,100,30d\ninvalid,bad,missing,-1,nonsense",
			[{ team_id: "team-a" } as AccessTeam],
		);
		expect(result.rows).toHaveLength(2);
		expect(result.rows[0].isValid).toBe(true);
		expect(result.rows[1]).toMatchObject({ rowNumber: 3, isValid: false });
		expect(result.rows[1].error).toContain("Unknown team(s): missing");
		expect(result.rows[1].error).toContain("Max budget must be greater than 0");
		expect(result.error).toContain("1 row(s) with errors");
	});
	it("sends only populated optional creation fields and retains quoted model/team lists", () => {
		const result = parseCsvUsers(
			'user_email,user_role,teams,max_budget,budget_duration,models\nuser@example.test,internal_user,"team-a,team-b",25,1mo,"model-a,model-b"',
			[],
		);
		expect(csvUserPayload(result.rows[0])).toEqual({
			user_email: "user@example.test",
			user_role: "internal_user",
			teams: ["team-a", "team-b"],
			max_budget: 25,
			budget_duration: "1mo",
			models: ["model-a", "model-b"],
		});
	});
});
