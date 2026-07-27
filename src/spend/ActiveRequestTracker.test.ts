import type { Request } from "express";
import { liteLLM_ActiveRequests } from "../db/schema/activeRequests";
import { CallType } from "../types/spend";
import { registerActiveRequest, startActiveRequestHeartbeat, trackSpendLog } from "./SpendTracker";

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
			headers: {},
			socket: {},
		} as unknown as Request;

		await registerActiveRequest(db as never, {
			req: req,
			requestId: "req-active",
			model: "model-a",
			callType: CallType.ACompletion,
			startTime: new Date("2026-07-27T00:00:00Z"),
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
		});
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
