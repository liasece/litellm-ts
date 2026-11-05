import { SessionTimelineBuilder, type SessionTimelineSourceRow } from "./sessionTimeline";
import { hydrateSessionTimelineImages, type SessionImageCandidate } from "./sessionTimelineImages";

const PATH = "/Users/example/outputs/golden-retriever.png";
const PROMPT = "一只金毛幼犬坐在草地上";
const SOURCE = "data:image/png;base64,iVBORw0KGgoAAA";
const COMMAND_TIME = "2026-11-03T09:19:15.000Z";
const OUTPUT_TIME = "2026-11-03T09:19:47.000Z";

function row(overrides: Partial<SessionTimelineSourceRow>): SessionTimelineSourceRow {
	return {
		request_id: "command",
		api_key: "key-a",
		call_type: "completion",
		spend: 0.01,
		total_tokens: 10,
		startTime: COMMAND_TIME,
		endTime: COMMAND_TIME,
		model: "assistant",
		status: "success",
		metadata_status: null,
		error_information: null,
		request_payload: {},
		response_payload: {},
		...overrides,
	};
}

function transcript(options: { raw?: string; key?: string; timestamp?: string; output?: string } = {}) {
	const command = `node /skills/clipa-imagegen/scripts/run-generate.mjs --prompt '${PROMPT}' --out ${PATH}`;
	const rows = [
		row({
			response_payload: {
				output: [
					{
						type: "custom_tool_call",
						name: "exec",
						call_id: "call-image",
						input: options.raw ?? `text(await tools.exec_command({cmd:${JSON.stringify(command)}}));`,
					},
				],
			},
		}),
		row({
			request_id: "output",
			api_key: options.key ?? "key-a",
			startTime: options.timestamp ?? OUTPUT_TIME,
			endTime: options.timestamp ?? OUTPUT_TIME,
			response_payload: {
				output: [
					{
						type: "message",
						role: "assistant",
						content: [{ type: "output_text", text: options.output ?? `![金毛幼犬](${PATH})` }],
					},
				],
			},
		}),
	];
	const builder = new SessionTimelineBuilder();
	rows.forEach((source) => builder.add(source));
	return { rows: rows, timeline: builder.build() };
}

describe("Session local image recovery", () => {
	it("restores a local Markdown image using a uniquely attributable generation, preserving the transcript and totals", async () => {
		const { rows, timeline } = transcript();
		const lookup = jest.fn().mockResolvedValue([
			{
				requestId: "generated-image",
				response: { data: [{ b64_json: "iVBORw0KGgoAAA" }], output_format: "png" },
			},
		]);
		const hydrated = await hydrateSessionTimelineImages(timeline, rows, lookup);
		expect(lookup).toHaveBeenCalledWith({
			apiKey: "key-a",
			prompt: PROMPT,
			from: new Date(COMMAND_TIME),
			to: new Date(OUTPUT_TIME),
		});
		expect(hydrated.data.find((event) => event.request_id === "output")).toMatchObject({
			content: `![金毛幼犬](${PATH})`,
			image_sources: { [PATH]: SOURCE },
		});
		expect(hydrated.summary).toEqual(timeline.summary);
		expect(timeline.data.every((event) => event.image_sources === undefined)).toBe(true);
	});

	it.each([
		{ key: "different-key" },
		{ timestamp: "2026-11-03T11:19:47.000Z" },
		{ timestamp: "2026-11-03T09:18:00.000Z" },
		{
			raw: `text(await tools.exec_command({cmd:${JSON.stringify(`node /skills/run-generate.mjs --prompt '${PROMPT}' --out ${PATH} --dry-run`)}}));`,
		},
		{
			raw: `text(await tools.exec_command({cmd:${JSON.stringify(`node /skills/run-generate.mjs --prompt "$PROMPT" --out ${PATH}`)}}));`,
		},
		{ output: "![external](https://example.com/image.png)" },
	])("does not look up images without exact local command provenance: %j", async (options) => {
		const { rows, timeline } = transcript(options);
		const lookup = jest.fn();
		const hydrated = await hydrateSessionTimelineImages(timeline, rows, lookup);
		expect(lookup).not.toHaveBeenCalled();
		expect(hydrated).toEqual(timeline);
	});

	it.each<{ candidates: SessionImageCandidate[] }>([
		{ candidates: [] },
		{
			candidates: [
				{ requestId: "a", response: {} },
				{ requestId: "b", response: {} },
			],
		},
		{
			candidates: [
				{ requestId: "truncated", response: { data: [{ b64_json: "iVBORw0KGgo... (litellm_truncated skipped 999 chars)" }] } },
			],
		},
		{ candidates: [{ requestId: "multiple", response: { data: [{ b64_json: "abc" }, { b64_json: "def" }] } }] },
	])("leaves unavailable or ambiguous generations unresolved", async ({ candidates }) => {
		const { rows, timeline } = transcript();
		expect(await hydrateSessionTimelineImages(timeline, rows, async () => candidates)).toEqual(timeline);
	});

	it("matches angle-bracket destinations and quoted paths with spaces without running the recorded command", async () => {
		const path = "/Users/example/My images/dog.png";
		const command = `node /skills/run-generate.mjs --prompt '${PROMPT}' --out '${path}'`;
		const { rows, timeline } = transcript({
			raw: `text(await tools.exec_command({cmd:${JSON.stringify(command)}}));`,
			output: `![金毛幼犬](<${path}>)`,
		});
		const result = await hydrateSessionTimelineImages(timeline, rows, async () => [
			{
				requestId: "image",
				response: { data: [{ b64_json: "iVBORw0KGgoAAA" }] },
			},
		]);
		expect(result.data.find((event) => event.request_id === "output")?.image_sources).toEqual({ [path]: SOURCE });
	});
});
