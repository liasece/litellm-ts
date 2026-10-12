import { resolveUsageScope, usageDateRange } from "./UsageQuery";
import { hashApiKey } from "../core/utils/crypto";

describe("bounded caller-scoped usage", () => {
	it("prevents callers selecting another subject and requires an organization admin", () => {
		const auth = { api_key: "sk-test", user_id: "u1", team_id: "t1", organization_id: "o1" };
		expect(resolveUsageScope(auth, "key")).toBe(hashApiKey("sk-test"));
		expect(resolveUsageScope(auth, "team", "t1")).toBe("t1");
		expect(() => resolveUsageScope(auth, "team", "t2")).toThrow();
		expect(() => resolveUsageScope(auth, "organization", "o1")).toThrow();
		expect(resolveUsageScope({ ...auth, user_role: "proxy_admin" }, "team", "t2")).toBe("t2");
	});
	it("includes the entire end day and rejects invalid or unbounded ranges", () => {
		expect(usageDateRange({ start_date: "2026-10-01", end_date: "2026-10-11" }).end.toISOString()).toBe("2026-10-12T00:00:00.000Z");
		for (const query of [
			{ start_date: "2026-02-30", end_date: "2026-03-01" },
			{ start_date: "2020-01-01", end_date: "2026-10-11" },
			{ start_date: "2026-10-12", end_date: "2026-10-11" },
		])
			expect(() => usageDateRange(query)).toThrow();
	});
});
