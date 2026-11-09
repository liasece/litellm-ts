import { liteLLM_ActiveRequests } from "../db/schema/activeRequests";
import { createModelResolutionTraceCollector } from "../router/ModelResolutionTrace";
import { publishModelResolutionTrace, recordUpstreamExchange, runWithUpstreamExchangeScope } from "../router/UpstreamExchange";
import type { UpstreamLogContext } from "../router/UpstreamLogContext";
import { buildActiveRequestRoutingPatch, buildActiveRequestUpstreamPatch, createActiveRequestJournal } from "./ActiveRequestJournal";

jest.mock("./SpendTracker", () => {
	const actual = jest.requireActual("./SpendTracker");
	return {
		...actual,
		shouldStoreUpstreamLogsInSpendLogs: jest.fn(async () => true),
	};
});

/** 记录每次 update().set() 的载荷，忽略 where 细节。 */
function createUpdateCapture() {
	const updates: Record<string, unknown>[] = [];
	const db = {
		update: jest.fn(() => ({
			set: jest.fn((values: Record<string, unknown>) => {
				updates.push(values);
				return { where: jest.fn(() => Promise.resolve()) };
			}),
		})),
	};
	return { db: db, updates: updates };
}

function upstreamContext(overrides: Partial<UpstreamLogContext> = {}): UpstreamLogContext {
	return {
		spendInfo: {
			customLlmProvider: "openai",
			apiBase: "https://api.example.com/v1",
			modelId: "deployment-1",
			deploymentModel: "openai/gpt-4o",
		},
		request: {
			url: "https://api.example.com/v1/chat/completions",
			method: "POST",
			headers: { authorization: "Bearer upstream-secret" },
			body: { model: "gpt-4o", messages: [] },
		},
		...overrides,
	};
}

describe("Active request journal", () => {
	it("persists the settled routing and upstream exchange of the first real dispatch", async () => {
		const capture = createUpdateCapture();
		await runWithUpstreamExchangeScope(async () => {
			const journal = createActiveRequestJournal(capture.db as never, "req-1", "public-model");
			expect(journal.observeUpstream()).toBe(true);
			recordUpstreamExchange(upstreamContext());
			await journal.flush();
		});

		expect(capture.updates).toHaveLength(1);
		expect(capture.updates[0]).toMatchObject({
			custom_llm_provider: "openai",
			api_base: "https://api.example.com/v1",
			model_id: "deployment-1",
		});
		expect(Object.keys(capture.updates[0] ?? {})).toEqual(
			expect.arrayContaining(["proxy_server_request", "updated_at"]),
		);
		expect(capture.updates[0]).toHaveProperty("metadata");
	});

	it("keeps the in-progress row small when upstream logging is disabled", async () => {
		const spendTracker = jest.requireMock("./SpendTracker") as {
			shouldStoreUpstreamLogsInSpendLogs: jest.Mock;
		};
		spendTracker.shouldStoreUpstreamLogsInSpendLogs.mockResolvedValueOnce(false);
		const capture = createUpdateCapture();
		await runWithUpstreamExchangeScope(async () => {
			const journal = createActiveRequestJournal(capture.db as never, "req-2", "public-model");
			journal.observeUpstream();
			recordUpstreamExchange(upstreamContext());
			await journal.flush();
		});

		expect(capture.updates).toHaveLength(1);
		expect(capture.updates[0]).not.toHaveProperty("proxy_server_request");
		expect(capture.updates[0]).toMatchObject({ custom_llm_provider: "openai" });
	});

	it("writes each routing progress once and never repeats an identical exchange", async () => {
		const capture = createUpdateCapture();
		const context = upstreamContext({
			response: { status_code: 200, headers: { "content-type": "application/json" }, body: { id: "cmpl-1" } },
		});
		await runWithUpstreamExchangeScope(async () => {
			const journal = createActiveRequestJournal(capture.db as never, "req-3", "public-model");
			journal.observeUpstream();
			recordUpstreamExchange(context);
			recordUpstreamExchange(context);
			await journal.flush();
			// 同一记录不重复补写，新的上游需要更新。
			recordUpstreamExchange(upstreamContext({ request: { ...context.request, url: "https://backup.example.com/v1/chat/completions" } }));
			await journal.flush();
		});

		expect(capture.updates).toHaveLength(2);
	});

	it("records the first chunk time once, keeping the earliest observation", async () => {
		const capture = createUpdateCapture();
		const journal = createActiveRequestJournal(capture.db as never, "req-4", "public-model");
		journal.markCompletionStart(new Date("2026-11-05T00:00:01.000Z"));
		journal.markCompletionStart(new Date("2026-11-05T00:00:05.000Z"));
		await journal.flush();

		expect(capture.updates).toHaveLength(1);
		expect(Object.keys(capture.updates[0] ?? {})).toEqual(expect.arrayContaining(["completion_start_time", "updated_at"]));
	});

	it("stays silent outside a request scope and swallows write failures", async () => {
		const failing = {
			update: jest.fn(() => ({
				set: jest.fn(() => ({ where: jest.fn(() => Promise.reject(new Error("db down"))) })),
			})),
		};
		const journal = createActiveRequestJournal(failing as never, "req-5", "public-model");
		expect(journal.observeUpstream()).toBe(false);
		journal.markCompletionStart(new Date("2026-11-05T00:00:01.000Z"));
		await expect(journal.flush()).resolves.toBeUndefined();
	});

	it("shapes the upstream patch with sanitized headers and the observed response", () => {
		const patch = buildActiveRequestUpstreamPatch(
			upstreamContext({
				response: { status_code: 200, headers: { "set-cookie": "secret" }, body: { id: "cmpl-1" } },
			}),
		);
		const request = patch["upstream_request"] as Record<string, unknown>;
		expect(request["url"]).toBe("https://api.example.com/v1/chat/completions");
		expect(request["body"]).toMatchObject({ model: "gpt-4o" });
		expect((patch["upstream_response"] as Record<string, unknown>)["status_code"]).toBe(200);
	});

	it("shapes the routing patch from the live trace collector", () => {
		const trace = createModelResolutionTraceCollector();
		trace.entries.push({
			fallback_index: 0,
			input_model: "alias-model",
			resolved_model: "real-model",
			resolution_path: ["alias-model", "real-model"],
		});
		trace.fallbackModels.push("alias-model");
		const patch = buildActiveRequestRoutingPatch(trace);
		expect(patch["model_resolution_chain"]).toEqual([
			{
				fallback_index: 0,
				input_model: "alias-model",
				resolved_model: "real-model",
				resolution_path: ["alias-model", "real-model"],
			},
		]);
		expect(patch["fallback_models"]).toEqual(["alias-model"]);
	});

	it("publishes the request trace for the journal to read", async () => {
		const capture = createUpdateCapture();
		await runWithUpstreamExchangeScope(async () => {
			const trace = createModelResolutionTraceCollector();
			trace.entries.push({
				fallback_index: 0,
				input_model: "alias-model",
				resolved_model: "real-model",
				resolution_path: ["alias-model", "real-model"],
			});
			trace.fallbackModels.push("alias-model");
			publishModelResolutionTrace(trace);
			const journal = createActiveRequestJournal(capture.db as never, "req-6", "public-model");
			journal.observeUpstream();
			recordUpstreamExchange(upstreamContext());
			await journal.flush();
		});


		expect(capture.updates[0]).toHaveProperty("metadata");
	});
});
