import { describe, expect, it } from "vitest";
import { formatRawLogs, presentLog } from "./LogPresentation";
import type { CliProxyLogEntry } from "../support/CliProxyModels";

describe("CLIProxy log presentation", () => {
	it("extracts request metadata without dropping the original readable message", () => {
		const entry: CliProxyLogEntry = {
			id: 12,
			timestamp: "2026-11-07T00:00:00.000Z",
			stream: "stdout",
			message: "\u001b[32m[GIN] 200 | 123.4ms | POST /v1/responses\u001b[0m",
		};
		const presented = presentLog(entry);
		expect(presented).toMatchObject({ level: "info", method: "POST", path: "/v1/responses", status: 200, latency: "123.4ms" });
		expect(presented.message).not.toContain("\u001b");
		expect(presented.message).toContain("[GIN] 200 | 123.4ms | POST /v1/responses");
	});

	it("classifies stderr as error and recognizes retry warnings on stdout", () => {
		const base = { id: 1, timestamp: "2026-11-07T00:00:00Z", message: "request accepted" };
		expect(presentLog({ ...base, stream: "stderr" }).level).toBe("error");
		expect(presentLog({ ...base, stream: "stdout", message: "retry scheduled after credential degraded" }).level).toBe("warn");
	});

	it("exports all source entries in order while stripping terminal color escapes", () => {
		const entries: CliProxyLogEntry[] = [
			{ id: 1, timestamp: "2026-11-07T00:00:00Z", stream: "system", message: "started" },
			{ id: 2, timestamp: "2026-11-07T00:00:01Z", stream: "oauth", message: "waiting for login" },
		];
		const raw = formatRawLogs(entries);
		expect(raw.split("\n")).toHaveLength(2);
		expect(raw.indexOf("[system] started")).toBeLessThan(raw.indexOf("[oauth] waiting for login"));
	});
});
