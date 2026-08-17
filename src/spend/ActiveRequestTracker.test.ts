import type { Request } from "express";
import { liteLLM_ActiveRequests } from "../db/schema/activeRequests";
import { CallType } from "../types/spend";
import { checkpointActiveRequest, registerActiveRequest, startActiveRequestHeartbeat, trackSpendLog } from "./SpendTracker";

describe("Active request tracking", () => {
	it("registers a lightweight in-progress row before provider execution", async () => {
		let inserted: Record<string, unknown> | undefined;
		let db: Record<string, unknown>;
		db = {
			transaction: jest.fn((callback: (tx: unknown) => Promise<unknown>) => callback(db)),
			select: jest.fn(() => ({
				from: jest.fn(() => ({
					where: jest.fn(() => ({
						limit: jest.fn(() => Promise.resolve([])),
					})),
				})),
			})),
			delete: jest.fn(() => ({
				where: jest.fn(() => Promise.resolve()),
			})),
			insert: jest.fn((table: unknown) => ({
				values: jest.fn((values: Record<string, unknown>) => {
					if (table === liteLLM_ActiveRequests) {
						inserted = values;
					}
					return {
						onConflictDoNothing: jest.fn(() => ({
							returning: jest.fn(() => Promise.resolve([{ requestId: "req-active" }])),
						})),
					};
				}),
			})),
		};
		const req = {
			auth: {
				api_key: "raw-key",
				token: "hashed-key",
				user_id: "user-1",
				team_id: "team-1",
				key_alias: "alias-1",
			},
			body: { metadata: { trace_id: "trace-1" } },
			method: "POST",
			originalUrl: "/v1/chat/completions",
			headers: { authorization: "Bearer secret" },
			socket: {},
		} as unknown as Request;
		const requestBody = {
			model: "model-a",
			messages: [{ role: "user", content: [{ type: "tool_result", content: "---\n\0binary output" }] }],
		};

		await registerActiveRequest(db as never, {
			req: req,
			requestId: "req-active",
			model: "model-a",
			callType: CallType.ACompletion,
			startTime: new Date("2026-07-27T00:00:00Z"),
			requestBody: requestBody,
		});

		expect(inserted).toMatchObject({
			request_id: "req-active",
			api_key: "hashed-key",
			model: "model-a",
			model_group: "model-a",
			user: "user-1",
			team_id: "team-1",
			session_id: "trace-1",
			status: "in_progress",
			metadata: { status: "in_progress", user_api_key_alias: "alias-1" },
			proxy_server_request: {
				url: "/v1/chat/completions",
				method: "POST",
				headers: { authorization: "[REDACTED]" },
				body: {
					model: "model-a",
					messages: [{ role: "user", content: [{ type: "tool_result", content: "---\n\\u0000binary output" }] }],
				},
			},
		});
		expect(requestBody.messages[0]?.content[0]?.content).toBe("---\n\0binary output");
	});

	it("renews and stops the active request lease heartbeat", async () => {
		const returning = jest.fn(() => Promise.resolve([{ requestId: "req-active" }]));
		const db = {
			update: jest.fn(() => ({
				set: jest.fn(() => ({
					where: jest.fn(() => ({ returning: returning })),
				})),
			})),
		};
		const heartbeat = startActiveRequestHeartbeat(db as never, "req-active", { intervalMs: 60_000 });

		await expect(heartbeat.renewNow()).resolves.toBe(true);
		heartbeat.stop();
		await expect(heartbeat.renewNow()).resolves.toBe(false);
		expect(returning).toHaveBeenCalledTimes(1);
	});

	it("persists a Responses execution checkpoint on the active request", async () => {
		const returning = jest.fn(() => Promise.resolve([{ requestId: "req-active" }]));
		const set = jest.fn(() => ({
			where: jest.fn(() => ({ returning: returning })),
		}));
		const db = {
			update: jest.fn(() => ({ set: set })),
		};

		await expect(
			checkpointActiveRequest(db as never, "req-active", {
				last_sse_event: "response.output_text.done",
				response: { id: "resp-1", status: "in_progress", partial_output_text: "hello" },
			}),
		).resolves.toBe(true);
		expect(set).toHaveBeenCalledTimes(1);
		expect(returning).toHaveBeenCalledTimes(1);
	});

	it("persists a streaming checkpoint under the streaming_execution key", async () => {
		const returning = jest.fn(() => Promise.resolve([{ requestId: "req-active" }]));
		const set = jest.fn(() => ({
			where: jest.fn(() => ({ returning: returning })),
		}));
		const db = {
			update: jest.fn(() => ({ set: set })),
		};

		await expect(
			checkpointActiveRequest(
				db as never,
				"req-active",
				{ response: { id: "resp-1", status: "in_progress", partial_output_text: "before\0after" } },
				"streaming_execution",
			),
		).resolves.toBe(true);

		const metadata = (set.mock.calls[0] as unknown as [{ metadata: unknown }])[0].metadata;
		const strings: string[] = [];
		const collect = (value: unknown): void => {
			if (typeof value === "string") {
				strings.push(value);
				return;
			}
			if (!value || typeof value !== "object") {
				return;
			}
			const obj = value as { value?: unknown; queryChunks?: unknown[] };
			if (Array.isArray(obj.value)) {
				for (const entry of obj.value) {
					if (typeof entry === "string") {
						strings.push(entry);
					}
				}
			}
			if (Array.isArray(obj.queryChunks)) {
				for (const chunk of obj.queryChunks) {
					collect(chunk);
				}
			}
		};
		collect(metadata);
		const sqlText = strings.join("");
		expect(sqlText).toContain("streaming_execution");
		expect(sqlText).not.toContain("responses_execution");
		expect(sqlText).toContain("\\u0000");
		expect(sqlText).not.toContain("\0");
	});

	it("deletes the active row in the same transaction as the final SpendLog", async () => {
		const deletedTables: unknown[] = [];
		let db: Record<string, unknown>;
		db = {
			transaction: jest.fn((callback: (tx: unknown) => Promise<unknown>) => callback(db)),
			select: jest.fn(() => ({
				from: jest.fn(() => ({
					where: jest.fn(() => Promise.resolve([])),
				})),
			})),
			update: jest.fn(() => ({
				set: jest.fn(() => ({ where: jest.fn(() => Promise.resolve()) })),
			})),
			delete: jest.fn((table: unknown) => {
				deletedTables.push(table);
				return { where: jest.fn(() => Promise.resolve()) };
			}),
			insert: jest.fn(() => ({
				values: jest.fn(() => ({
					onConflictDoNothing: jest.fn(() => ({
						returning: jest.fn(() => Promise.resolve([{ requestId: "req-active" }])),
					})),
					onConflictDoUpdate: jest.fn(() => Promise.resolve()),
				})),
			})),
		};

		await expect(
			trackSpendLog(db as never, {
				api_key: "",
				call_type: CallType.ACompletion,
				completion_tokens: 1,
				endTime: "2026-07-27T00:00:01Z",
				model: "unknown-model-cost-zero",
				prompt_tokens: 1,
				request_id: "req-active",
				spend: 0,
				startTime: "2026-07-27T00:00:00Z",
				total_tokens: 2,
			}),
		).resolves.toMatchObject({ status: "committed", requestId: "req-active" });
		expect(deletedTables).toContain(liteLLM_ActiveRequests);
	});
});
