import { describe, expect, it } from "vitest";
import { parseUserContextPrefixes, parseTranscriptEntries, orderSessionTimeline } from "./SessionTimelineContentLogic";
describe("Session IDE context and transcript replay", () => {
	it("consumes only complete leading context blocks in their original order", () => {
		const source =
			"<ide_opened_file>The user opened the file /fixture/app.ts in the IDE.</ide_opened_file>\n<system-reminder>Remember tests</system-reminder>\n<transcript>User: Earlier question</transcript>\nCurrent question";
		const parsed = parseUserContextPrefixes(source);
		expect(parsed.blocks.map((block) => block.kind)).toEqual(["ide_opened_file", "system_reminder", "transcript"]);
		expect(parsed.blocks[0].kind === "ide_opened_file" ? parsed.blocks[0].context.path : null).toBe("/fixture/app.ts");
		expect(parsed.remainingContent).toBe("Current question");
		expect(parseUserContextPrefixes("Explain <system-reminder>tags</system-reminder>").blocks).toEqual([]);
		expect(parseUserContextPrefixes("<system-reminder>unfinished").remainingContent).toBe("<system-reminder>unfinished");
	});
	it("recognizes conservative tool records without treating ordinary English as a command", () => {
		const result = parseTranscriptEntries("User: Hello\n\nBash npm test\n\nRead the docs carefully\n\nReading should be easy");
		expect(result.map((entry) => entry.kind)).toEqual(["user", "tool", "tool", "text"]);
		expect(result[1].toolName).toBe("Bash");
	});
	it("reverses API conversation order without using timestamps to invent a different order", () => {
		const base = { request_id: "request", role: "assistant" as const, label: "Assistant", model: "fixture", content: "text" };
		const timeline = [
			{ ...base, id: "first", timestamp: "2026-11-07T02:00:02Z" },
			{ ...base, id: "second", timestamp: "2026-11-07T02:00:01Z" },
		];
		expect(orderSessionTimeline(timeline, false).map((item) => item.id)).toEqual(["first", "second"]);
		expect(orderSessionTimeline(timeline, true).map((item) => item.id)).toEqual(["second", "first"]);
	});
});
