import type { Request } from "express";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { liteLLM_ActiveRequests } from "../db/schema/activeRequests";
import { liteLLM_SpendLogBlocks } from "../db/schema/spendLogBlocks";
import { CallType } from "../types/spend";
import { checkpointActiveRequest, registerActiveRequest, startActiveRequestHeartbeat, trackSpendLog } from "./SpendTracker";
import { SPEND_LOG_MESSAGE_REF_KEY, restoreSpendLogPayload } from "./SpendLogBlocks";
import { subscribeSpendLogChanges } from "./spendLogChangeFeed";

/**
 * 在途登记把「已结算判存 + 过期行接管 + 登记」合并成一条语句：这里按 SELECT 列顺序
 * 还原绑定值，让断言继续面向行内容而不是 SQL 文本。
 * @param statement - drizzle 生成的 SQL 对象
 */
function capturedActiveRequestRow(statement: unknown): Record<string, unknown> {
	const chunks = (statement as { queryChunks?: { constructor: { name: string } }[] }).queryChunks ?? [];
	const [requestId, callType, apiKey, startTime, model, modelGroup, user, teamId, organizationId, endUser, ip, sessionId, metadata, proxyServerRequest, expiresAt, updatedAt] =
		chunks.filter((chunk) => chunk?.constructor?.name !== "StringChunk") as unknown[];
	return {
		request_id: requestId,
		call_type: callType,
		api_key: apiKey,
		startTime: startTime,
		model: model,
		model_group: modelGroup,
		user: user,
		team_id: teamId,
		organization_id: organizationId,
		end_user: endUser,
		requester_ip_address: ip,
		session_id: sessionId,
		metadata: JSON.parse(String(metadata)),
		proxy_server_request: JSON.parse(String(proxyServerRequest)),
		status: "in_progress",
		expires_at: expiresAt,
		updated_at: updatedAt,
	};
}

/** 按注册时写入的块还原在途行正文：断言面向内容，不锁定行内存储形态。 */
function restoreInProgressBody(
	proxyServerRequest: unknown,
	blocks: readonly { blockId: string; payload: unknown }[],
): Record<string, unknown> {
	const payloads = new Map(blocks.map((block) => [block.blockId, block.payload] as const));
	return restoreSpendLogPayload({ proxy_server_request: proxyServerRequest }, (blockId) => payloads.get(blockId))
		.proxyServerRequest as Record<string, unknown>;
}

describe("Active request tracking", () => {
	it("registers a lightweight in-progress row before provider execution", async () => {
		let inserted: Record<string, unknown> | undefined;
		const blocks: { blockId: string; payload: unknown }[] = [];
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
			execute: jest.fn((statement: unknown) => {
				inserted = capturedActiveRequestRow(statement);
				return Promise.resolve({ rows: [{ request_id: String(inserted["request_id"]) }] });
			}),
			insert: jest.fn((table: unknown) => ({
				values: jest.fn((values: unknown) => {
					if (table === liteLLM_ActiveRequests) {
						inserted = values as Record<string, unknown>;
					}
					if (table === liteLLM_SpendLogBlocks) {
						blocks.push(...(values as { blockId: string; payload: unknown }[]));
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
				headers: { authorization: "Bearer secret" },
			},
		});
		// 正文按内容寻址落在块表：行里只有引用，读取时再组装。
		const storedProxyServerRequest = inserted?.["proxy_server_request"] as Record<string, unknown>;
		const storedBody = storedProxyServerRequest["body"] as Record<string, unknown>;
		expect(storedBody[SPEND_LOG_MESSAGE_REF_KEY]).toHaveLength(1);
		expect(blocks).toHaveLength(1);
		expect(restoreInProgressBody(storedProxyServerRequest, blocks)["body"]).toEqual({
			model: "model-a",
			messages: [{ role: "user", content: [{ type: "tool_result", content: "---\n\\u0000binary output" }] }],
		});
		expect(requestBody.messages[0]?.content[0]?.content).toBe("---\n\0binary output");
	});

	it("carries the settled key ownership and session group into the in-progress row", async () => {
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
			execute: jest.fn((statement: unknown) => {
				inserted = capturedActiveRequestRow(statement);
				return Promise.resolve({ rows: [{ request_id: String(inserted["request_id"]) }] });
			}),
			insert: jest.fn((table: unknown) => ({
				values: jest.fn((values: Record<string, unknown>) => {
					if (table === liteLLM_ActiveRequests) {
						inserted = values;
					}
					return {
						onConflictDoNothing: jest.fn(() => ({
							returning: jest.fn(() => Promise.resolve([{ requestId: "req-session" }])),
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
				team_alias: "team-alias",
				organization_id: "org-1",
				project_id: "project-1",
			},
			body: {},
			method: "POST",
			originalUrl: "/v1/chat/completions",
			headers: { session_id: "3f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8" },
			socket: {},
		} as unknown as Request;

		await registerActiveRequest(db as never, {
			req: req,
			requestId: "req-session",
			model: "model-a",
			callType: CallType.ACompletion,
			startTime: new Date("2026-07-27T00:00:00Z"),
			requestBody: { model: "model-a" },
		});

		expect(inserted?.["metadata"]).toMatchObject({
			status: "in_progress",
			user_api_key_alias: "alias-1",
			user_api_key_team_alias: "team-alias",
			user_api_key_org_id: "org-1",
			user_api_key_project_id: "project-1",
			session_group_key: "s:3f1a2b3c-4d5e-6f70-8192-a3b4c5d6e7f8",
		});

		// 生产上的 Claude Code 请求把整段会话写在 metadata.user_id 里，落 c: 键。
		const claudeCodeUserId = "user_device-1_account__session_63c6d8fc-3ca5-4f54-8cd9-aae8ca57dad9";
		await registerActiveRequest(db as never, {
			req: {
				...(req as unknown as Record<string, unknown>),
				body: { metadata: { user_id: claudeCodeUserId } },
			} as unknown as Request,
			requestId: "req-claude-code",
			model: "model-a",
			callType: CallType.ACompletion,
			startTime: new Date("2026-07-27T00:00:00Z"),
			requestBody: { model: "model-a" },
		});

		expect(inserted?.["metadata"]).toMatchObject({ session_group_key: `c:${claudeCodeUserId}` });
	});

	it("keeps image attachments in the in-progress request body", async () => {
		let inserted: Record<string, unknown> | undefined;
		const blocks: { blockId: string; payload: unknown }[] = [];
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
			execute: jest.fn((statement: unknown) => {
				inserted = capturedActiveRequestRow(statement);
				return Promise.resolve({ rows: [{ request_id: String(inserted["request_id"]) }] });
			}),
			insert: jest.fn((table: unknown) => ({
				values: jest.fn((values: unknown) => {
					if (table === liteLLM_ActiveRequests) {
						inserted = values as Record<string, unknown>;
					}
					if (table === liteLLM_SpendLogBlocks) {
						blocks.push(...(values as { blockId: string; payload: unknown }[]));
					}
					return {
						onConflictDoNothing: jest.fn(() => ({
							returning: jest.fn(() => Promise.resolve([{ requestId: "req-image" }])),
						})),
					};
				}),
			})),
		};
		const dataUri = `data:image/png;base64,${"A".repeat(40_000)}`;
		const longText = "B".repeat(40_000);
		const req = {
			auth: { api_key: "raw-key", token: "hashed-key", user_id: "user-1" },
			body: {},
			method: "POST",
			originalUrl: "/v1/chat/completions",
			headers: {},
			socket: {},
		} as unknown as Request;

		await registerActiveRequest(db as never, {
			req: req,
			requestId: "req-image",
			model: "model-a",
			callType: CallType.ACompletion,
			startTime: new Date("2026-07-27T00:00:00Z"),
			requestBody: {
				model: "model-a",
				messages: [
					{
						role: "user",
						content: [
							{ type: "image_url", image_url: { url: dataUri } },
							{ type: "text", text: longText },
						],
					},
				],
			},
		});

		const storedProxyServerRequest = inserted?.["proxy_server_request"] as Record<string, unknown>;
		// 图片与超长文本不进在途行：行里只有消息引用，读取时组装回原内容。
		expect(JSON.stringify(storedProxyServerRequest)).not.toContain(dataUri);
		const restoredBody = restoreInProgressBody(storedProxyServerRequest, blocks)["body"] as {
			messages: Array<{ content: Array<Record<string, unknown>> }>;
		};
		const content = restoredBody.messages[0]?.content ?? [];
		// 日志侧只做 NUL 转义，不再截断：图片与超长文本都原样保留。
		expect((content[0]?.["image_url"] as { url: string }).url).toBe(dataUri);
		expect(content[1]?.["text"]).toBe(longText);
	});

	it("把几十 KB 的在途正文落成引用，行宽不再随会话增长", async () => {
		let inserted: Record<string, unknown> | undefined;
		const blocks: { blockId: string; payload: unknown }[] = [];
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
			execute: jest.fn((statement: unknown) => {
				inserted = capturedActiveRequestRow(statement);
				return Promise.resolve({ rows: [{ request_id: String(inserted["request_id"]) }] });
			}),
			insert: jest.fn((table: unknown) => ({
				values: jest.fn((values: unknown) => {
					if (table === liteLLM_ActiveRequests) {
						inserted = values as Record<string, unknown>;
					}
					if (table === liteLLM_SpendLogBlocks) {
						blocks.push(...(values as { blockId: string; payload: unknown }[]));
					}
					return {
						onConflictDoNothing: jest.fn(() => ({
							returning: jest.fn(() => Promise.resolve([{ requestId: "req-wide" }])),
						})),
					};
				}),
			})),
		};
		const messages = Array.from({ length: 6 }, (_unused, index) => ({
			role: index % 2 === 0 ? "user" : "assistant",
			content: [{ type: "text", text: `${index}:` + "H".repeat(8_000) }],
		}));

		await registerActiveRequest(db as never, {
			req: {
				auth: { api_key: "raw-key", token: "hashed-key", user_id: "user-1" },
				body: {},
				method: "POST",
				originalUrl: "/v1/messages",
				headers: {},
				socket: {},
			} as unknown as Request,
			requestId: "req-wide",
			model: "model-a",
			callType: CallType.ACompletion,
			startTime: new Date("2026-07-27T00:00:00Z"),
			requestBody: { model: "model-a", messages },
		});

		// 48 KB 的正文不再进入行：只有 6 个 22 字符引用。
		expect(JSON.stringify(messages).length).toBeGreaterThan(40_000);
		expect(JSON.stringify(inserted?.["proxy_server_request"]).length).toBeLessThan(2_000);
		expect(blocks).toHaveLength(6);
		expect((restoreInProgressBody(inserted?.["proxy_server_request"], blocks)["body"] as Record<string, unknown>)["messages"]).toEqual(
			messages,
		);
	});

	it("keeps generated image output in the streaming checkpoint", async () => {
		const returning = jest.fn(() => Promise.resolve([{ requestId: "req-image" }]));
		const set = jest.fn(() => ({
			where: jest.fn(() => ({ returning: returning })),
		}));
		const db = { update: jest.fn(() => ({ set: set })) };
		const imageBase64 = "A".repeat(40_000);

		await checkpointActiveRequest(
			db as never,
			"req-image",
			{ response: { data: [{ b64_json: imageBase64 }] } },
			"streaming_execution",
		);

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
		expect(sqlText).toContain(imageBase64);
		expect(sqlText).not.toContain("litellm_truncated");
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
				set: jest.fn(() => ({ where: jest.fn(() => ({ returning: jest.fn(() => Promise.resolve([])) })) })),
			})),
			execute: jest.fn(() => Promise.resolve({ rows: [] })),
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

	it("publishes a list change when an in-progress row appears, but not for a detail-only checkpoint", async () => {
		const changes: string[] = [];
		const unsubscribe = subscribeSpendLogChanges(() => changes.push("changed"));
		try {
			let registered: Record<string, unknown> | undefined;
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
				execute: jest.fn((statement: unknown) => {
					registered = capturedActiveRequestRow(statement);
					return Promise.resolve({ rows: [{ request_id: String(registered["request_id"]) }] });
				}),
				insert: jest.fn(() => ({
					values: jest.fn(() => ({
						onConflictDoNothing: jest.fn(() => ({
							returning: jest.fn(() => Promise.resolve([{ requestId: "req-notify" }])),
						})),
					})),
				})),
			};
			await registerActiveRequest(db as never, {
				req: {
					auth: { api_key: "raw-key", token: "hashed-key", user_id: "user-1" },
					body: {},
					method: "POST",
					originalUrl: "/v1/chat/completions",
					headers: {},
					socket: {},
				} as unknown as Request,
				requestId: "req-notify",
				model: "model-a",
				callType: CallType.ACompletion,
				startTime: new Date("2026-07-27T00:00:00Z"),
				requestBody: { model: "model-a" },
			});

			const checkpointDb = {
				update: jest.fn(() => ({
					set: jest.fn(() => ({
						where: jest.fn(() => ({
							returning: jest.fn(() => Promise.resolve([{ requestId: "req-notify" }])),
						})),
					})),
				})),
			};
			await checkpointActiveRequest(
				checkpointDb as never,
				"req-notify",
				{ usage: { total_tokens: 3 } },
				"streaming_execution",
			);

			// checkpoint 内容只进详情页，列表行不变；持续流式时不应把列表刷新压到 500ms 下限。
			expect(changes).toEqual(["changed"]);
		} finally {
			unsubscribe();
		}
	});

	it("登记语句同时承担已结算判存与过期行接管，未命中时仍按重复 request_id 拒绝", async () => {
		let statementText = "";
		let db: Record<string, unknown>;
		db = {
			transaction: jest.fn((callback: (tx: unknown) => Promise<unknown>) => callback(db)),
			select: jest.fn(() => ({
				from: jest.fn(() => ({ where: jest.fn(() => ({ limit: jest.fn(() => Promise.resolve([])) })) })),
			})),
			insert: jest.fn(() => ({
				values: jest.fn(() => ({ onConflictDoNothing: jest.fn(() => Promise.resolve()) })),
			})),
			execute: jest.fn((statement: unknown) => {
				statementText = new PgDialect().sqlToQuery(statement as SQL).sql;
				return Promise.resolve({ rows: [] });
			}),
		};
		const req = {
			auth: { api_key: "raw-key", token: "hashed-key", user_id: "user-1" },
			body: {},
			method: "POST",
			originalUrl: "/v1/chat/completions",
			headers: {},
			socket: {},
		} as unknown as Request;

		await expect(
			registerActiveRequest(db as never, {
				req: req,
				requestId: "req-duplicate",
				model: "model-a",
				callType: CallType.ACompletion,
				startTime: new Date("2026-07-27T00:00:00Z"),
				requestBody: { model: "model-a" },
			}),
		).rejects.toMatchObject({ statusCode: 409 });

		// 已结算判存、过期接管、幂等插入必须落在同一条语句里：任何一步单独一条都会多一次往返。
		expect(statementText).toContain('INSERT INTO "LiteLLM_ActiveRequests"');
		expect(statementText).toContain('WHERE NOT EXISTS (SELECT 1 FROM "LiteLLM_SpendLogs" WHERE request_id = $17)');
		expect(statementText).toContain("ON CONFLICT (request_id) DO UPDATE SET");
		expect(statementText).toContain("WHERE active.expires_at <= $18::timestamp");
	});
});
