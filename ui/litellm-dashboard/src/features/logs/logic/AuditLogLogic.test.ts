import { describe, expect, it } from "vitest";
import { auditDiff } from "./AuditLogLogic";
import type { AuditLogEntry } from "../api/AuxiliaryLogsApi";
const log = (fields: Partial<AuditLogEntry>): AuditLogEntry => ({
	id: "audit-1",
	updated_at: "2026-11-07T02:00:00Z",
	action: "updated",
	table_name: "LiteLLM_TeamTable",
	object_id: "team-1",
	...fields,
});
describe("audit before/after details", () => {
	it("shows only differing fields while retaining additions and removals", () => {
		const result = auditDiff(log({ before_value: { same: 1, remove: 2, change: 3 }, updated_values: { same: 1, change: 4, add: 5 } }));
		expect(result.before).toEqual({ remove: 2, change: 3 });
		expect(result.after).toEqual({ change: 4, add: 5 });
	});
	it("uses full values for create/delete and reports an unchanged update explicitly", () => {
		expect(auditDiff(log({ action: "created", before_value: null, updated_values: { same: 1 } }))).toEqual({
			before: null,
			after: { same: 1 },
		});
		expect(auditDiff(log({ before_value: { same: 1 }, updated_values: { same: 1 } }))).toEqual({
			before: { note: "No differing fields detected" },
			after: { note: "No differing fields detected" },
		});
	});
	it("treats prototype-like field names as data when building a diff", () => {
		const before: Record<string, unknown> = JSON.parse('{"__proto__":{"x":1}}'),
			after: Record<string, unknown> = JSON.parse('{"__proto__":{"x":2}}');
		const result = auditDiff(log({ before_value: before, updated_values: after }));
		expect(Object.getPrototypeOf(result.before)).toBeNull();
		expect(result.after?.["__proto__"]).toEqual({ x: 2 });
	});
});
