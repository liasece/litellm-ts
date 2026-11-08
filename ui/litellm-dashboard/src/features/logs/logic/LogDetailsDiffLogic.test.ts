import { describe, expect, it } from "vitest";
import { buildFoldedDiffRows, getRequestProtocol } from "./LogDetailsDiffLogic";
describe("recorded upstream/downstream diff", () => {
	it("identifies the provider protocol of a recorded exchange", () => {
		expect(getRequestProtocol({ url: "https://provider.test/v1/messages" })).toBe("Anthropic Messages");
		expect(getRequestProtocol({ url: "/v1/responses" })).toBe("Responses");
	});
	it("aligns additions and removals and folds only long unchanged blocks", () => {
		const left = Array.from({ length: 250 }, (_, i) => "line " + i),
			right = [...left];
		right[125] = "changed";
		const rows = buildFoldedDiffRows(left.join("\n"), right.join("\n"));
		const change = rows.find((row) => row.kind === "change");
		expect(change && change.kind === "change" ? change.left?.lineNumber : 0).toBe(126);
		expect(rows.some((row) => row.kind === "fold")).toBe(true);
	});
	it("uses bounded-memory alignment for a large provider exchange while retaining both payloads", () => {
		const left = Array.from({ length: 2200 }, (_, i) => "entry " + i),
			right = [...left];
		right.splice(1100, 0, "provider-only");
		const rows = buildFoldedDiffRows(left.join("\n"), right.join("\n")).flatMap((row) => (row.kind === "fold" ? row.hidden : [row]));
		expect(rows.flatMap((row) => (row.left ? [row.left.text] : []))).toEqual(left);
		expect(rows.flatMap((row) => (row.right ? [row.right.text] : []))).toEqual(right);
	});
});
