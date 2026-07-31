/**
 * KeyManagement /key/delete 契约测试
 *
 * 锁定 Python LiteLLM `KeyRequest` 行为：keys/key_aliases 至少一个非空，keys 优先。
 * 明文 sk-* 经 hashApiKey 后匹配；hashed token 直接匹配。
 * 响应回显原请求数组，{ deleted_keys: requestedValues }。
 * 协议源码：https://github.com/BerriAI/litellm/blob/main/litellm/proxy/_types.py (KeyRequest)
 * 协议源码：https://github.com/BerriAI/litellm/blob/main/litellm/proxy/key_management_endpoints.py (/key/delete)
 */
import express from "express";
import request from "supertest";
import { createKeyManagementRoutes } from "./KeyManagementEndpoint";
import { hashApiKey } from "../core/utils/crypto";

interface MockDbState {
	rows: Array<Record<string, unknown>>;
	deletedTokens: string[];
	auditRows: Array<Record<string, unknown>>;
	insertCalls: Array<{ values: Record<string, unknown> }>;
	selectConditions: unknown[];
	transactionCount: number;
}

function collectStrings(value: unknown, out: string[] = [], seen: WeakSet<object> = new WeakSet(), depth = 0): string[] {
	if (typeof value === "string") {
		out.push(value);
		return out;
	}
	if (depth > 6) {
		return out;
	}
	if (Array.isArray(value)) {
		for (const item of value) {
			collectStrings(item, out, seen, depth + 1);
		}
		return out;
	}
	if (value && typeof value === "object") {
		if (seen.has(value)) {
			return out;
		}
		seen.add(value);
		for (const item of Object.values(value as Record<string, unknown>)) {
			collectStrings(item, out, seen, depth + 1);
		}
	}
	return out;
}

function filterRowsByCondition(rows: Array<Record<string, unknown>>, condition: unknown): Array<Record<string, unknown>> {
	const strings = new Set(collectStrings(condition));
	if (strings.size === 0) {
		return [];
	}
	return rows.filter((row) => {
		const token = row.token;
		const keyAlias = row.keyAlias;
		return (typeof token === "string" && strings.has(token)) || (typeof keyAlias === "string" && strings.has(keyAlias));
	});
}

function makeDeleteMockDb(initialRows: Array<Record<string, unknown>>): { db: unknown; state: MockDbState } {
	const state: MockDbState = {
		rows: initialRows.map((row) => ({ ...row })),
		deletedTokens: [],
		auditRows: [],
		insertCalls: [],
		selectConditions: [],
		transactionCount: 0,
	};

	const db: Record<string, unknown> = {
		select: () => ({
			from: () => ({
				where: (condition: unknown) => {
					state.selectConditions.push(condition);
					return Promise.resolve(filterRowsByCondition(state.rows, condition));
				},
			}),
		}),
		insert: () => ({
			values: (values: Record<string, unknown> | Array<Record<string, unknown>>) => {
				const rows = Array.isArray(values) ? values : [values];
				for (const row of rows) {
					state.insertCalls.push({ values: { ...row } });
					state.auditRows.push({ ...row });
				}
				return Promise.resolve();
			},
		}),
		delete: () => ({
			where: (condition: unknown) => {
				const matched = filterRowsByCondition(state.rows, condition);
				const matchedTokens = new Set(matched.map((row) => row.token));
				state.deletedTokens.push(...matched.map((row) => row.token as string));
				state.rows = state.rows.filter((row) => !matchedTokens.has(row.token));
				return Promise.resolve({ rowCount: matched.length });
			},
		}),
	};
	db.transaction = async (callback: (tx: unknown) => Promise<unknown>) => {
		state.transactionCount += 1;
		return callback(db);
	};

	return { db: db, state: state };
}

function makeApp(db: unknown): express.Express {
	const app = express();
	app.use(express.json());
	const router = express.Router();
	createKeyManagementRoutes(router, db as never, null);
	app.use(router);
	return app;
}

describe("KeyManagement /key/delete 契约", () => {
	it("POST /key/delete with { keys: [hashedToken] } 应返回 200 { deleted_keys: [hashedToken] }，并归档+删除 active token", async () => {
		const hashed = "hashed-token-1";
		const { db, state } = makeDeleteMockDb([{ token: hashed, keyAlias: "alias-1", keyName: "sk-...a" }]);

		const app = makeApp(db);
		const res = await request(app)
			.post("/key/delete")
			.send({ keys: [hashed] });

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ deleted_keys: [hashed] });
		expect(state.auditRows).toHaveLength(1);
		expect(state.auditRows[0]).toMatchObject({ token: hashed, keyAlias: "alias-1", keyName: "sk-...a" });
		expect(state.auditRows[0]?.activeTokenId).toBeUndefined();
		expect(state.auditRows[0]?.deletedAt).toBeInstanceOf(Date);
		expect(state.transactionCount).toBe(1);
		expect(state.deletedTokens).toContain(hashed);
	});

	it("POST /key/delete with { keys: [plainSkKey] } 应先 hash 再匹配，响应回显明文", async () => {
		const plain = "sk-plain-user-key-1234567890";
		const hashed = hashApiKey(plain);
		expect(hashed).not.toBe(plain);
		expect(hashed).toMatch(/^[0-9a-f]{64}$/);

		const { db, state } = makeDeleteMockDb([{ token: hashed, keyAlias: null, keyName: null }]);

		const app = makeApp(db);
		const res = await request(app)
			.post("/key/delete")
			.send({ keys: [plain] });

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ deleted_keys: [plain] });
		expect(res.body.deleted_keys[0]).toBe(plain);
		expect(res.body.deleted_keys[0]).not.toBe(hashed);
		expect(state.auditRows[0]?.token).toBe(hashed);
	});

	it("POST /key/delete with { key_aliases: [alias] } 应按 alias 命中实际 token，响应回显 alias", async () => {
		const hashed = "hashed-token-for-alias";
		const { db, state } = makeDeleteMockDb([{ token: hashed, keyAlias: "my-alias", keyName: "sk-...a" }]);

		const app = makeApp(db);
		const res = await request(app)
			.post("/key/delete")
			.send({ key_aliases: ["my-alias"] });

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ deleted_keys: ["my-alias"] });
		expect(state.auditRows[0]?.token).toBe(hashed);
		expect(state.deletedTokens).toContain(hashed);
	});

	it("同时传 keys 和 key_aliases 时应优先按 keys 删除，响应回显 keys", async () => {
		const hashed = "hashed-token-keys-wins";
		const { db, state } = makeDeleteMockDb([{ token: hashed, keyAlias: "alias-should-be-ignored", keyName: "sk-...a" }]);

		const app = makeApp(db);
		const res = await request(app)
			.post("/key/delete")
			.send({ keys: [hashed], key_aliases: ["alias-should-be-ignored"] });

		expect(res.status).toBe(200);
		expect(res.body).toEqual({ deleted_keys: [hashed] });
		expect(state.auditRows[0]?.token).toBe(hashed);
	});

	it("批量删除任一 key 不存在时不产生部分成功", async () => {
		const { db, state } = makeDeleteMockDb([{ token: "existing", keyAlias: null }]);
		const res = await request(makeApp(db))
			.post("/key/delete")
			.send({ keys: ["existing", "missing"] });

		expect(res.status).toBe(404);
		expect(state.auditRows).toHaveLength(0);
		expect(state.deletedTokens).toHaveLength(0);
		expect(state.rows).toHaveLength(1);
	});

	it("缺少 keys/key_aliases 或两者均为空数组时返回 400 与精确 message", async () => {
		const { db } = makeDeleteMockDb([]);
		const app = makeApp(db);

		const res1 = await request(app).post("/key/delete").send({});
		expect(res1.status).toBe(400);
		expect(res1.body.error.message).toBe("At least one of 'keys' or 'key_aliases' must be provided.");

		const res2 = await request(app).post("/key/delete").send({ keys: [], key_aliases: [] });
		expect(res2.status).toBe(400);
		expect(res2.body.error.message).toBe("At least one of 'keys' or 'key_aliases' must be provided.");
	});

	it("找不到匹配 key 时返回 404 'No keys found'", async () => {
		const { db } = makeDeleteMockDb([]);
		const app = makeApp(db);
		const res = await request(app)
			.post("/key/delete")
			.send({ keys: ["nonexistent-hash"] });

		expect(res.status).toBe(404);
		expect(res.body.error.message).toBe("No keys found");
	});
});
describe("KeyManagement /key/regenerate 生命周期", () => {
	function makeRegenerateMockDb(row: Record<string, unknown>) {
		const state = {
			row: { ...row },
			deprecatedRows: [] as Array<Record<string, unknown>>,
			transactionCount: 0,
		};
		const db: Record<string, unknown> = {
			select: () => ({
				from: () => ({
					where: (condition: unknown) => ({
						limit: () => {
							const strings = new Set(collectStrings(condition));
							return Promise.resolve(strings.has(String(state.row.token)) ? [state.row] : []);
						},
					}),
				}),
			}),
			update: () => ({
				set: (values: Record<string, unknown>) => ({
					where: () => {
						state.row = { ...state.row, ...values };
						return Promise.resolve({ rowCount: 1 });
					},
				}),
			}),
			insert: () => ({
				values: (values: Record<string, unknown>) => {
					state.deprecatedRows.push({ ...values });
					return Promise.resolve();
				},
			}),
		};
		db.transaction = async (callback: (tx: unknown) => Promise<unknown>) => {
			state.transactionCount += 1;
			return callback(db);
		};
		return { db: db, state: state };
	}

	it("在单事务内轮换主键并保留 project/agent/router/policy/access-group/预算字段", async () => {
		const oldToken = "old-token";
		const { db, state } = makeRegenerateMockDb({
			token: oldToken,
			keyName: "old-name",
			userId: "user-a",
			teamId: "team-a",
			agentId: "agent-a",
			projectId: "project-a",
			organizationId: "org-a",
			routerSettings: { strategy: "usage-based-routing" },
			policies: ["policy-a"],
			accessGroupIds: ["group-a"],
			budgetId: "budget-a",
			modelMaxBudget: { model: 10 },
			models: ["model"],
		});

		const res = await request(makeApp(db)).post("/key/regenerate").send({ token: oldToken, grace_period: "1h" });

		expect(res.status).toBe(200);
		expect(state.transactionCount).toBe(1);
		expect(state.row.token).toBe(res.body.token);
		expect(state.row).toMatchObject({
			agentId: "agent-a",
			projectId: "project-a",
			routerSettings: { strategy: "usage-based-routing" },
			policies: ["policy-a"],
			accessGroupIds: ["group-a"],
			budgetId: "budget-a",
			modelMaxBudget: { model: 10 },
		});
		expect(state.deprecatedRows).toHaveLength(1);
		expect(state.deprecatedRows[0]).toMatchObject({ token: oldToken, activeTokenId: res.body.token });
		expect(state.deprecatedRows[0]?.revokeAt).toBeInstanceOf(Date);
	});

	it("未配置 grace period 时立即撤销旧 key，不写 deprecated 映射", async () => {
		const { db, state } = makeRegenerateMockDb({ token: "old-token", keyName: "old", models: [] });
		const previous = process.env.LITELLM_KEY_ROTATION_GRACE_PERIOD;
		delete process.env.LITELLM_KEY_ROTATION_GRACE_PERIOD;
		try {
			const res = await request(makeApp(db)).post("/key/regenerate").send({ token: "old-token" });
			expect(res.status).toBe(200);
			expect(state.deprecatedRows).toHaveLength(0);
		} finally {
			if (previous !== undefined) {
				process.env.LITELLM_KEY_ROTATION_GRACE_PERIOD = previous;
			}
		}
	});
});

describe("KeyManagement /key/info 与 /key/list parity", () => {
	function makeKeyInfoMockDb(rows: Array<Record<string, unknown>>): unknown {
		return {
			select: () => ({
				from: () => ({
					where: (condition: unknown) => {
						const matched = filterRowsByCondition(rows, condition);
						const result = matched as Array<Record<string, unknown>> & {
							limit: (n: number) => Promise<Array<Record<string, unknown>>>;
						};
						result.limit = (n: number) => Promise.resolve(matched.slice(0, n));
						return result;
					},
				}),
			}),
		};
	}

	function makeKeyListMockDb(rows: Array<Record<string, unknown>>): unknown {
		return {
			select: () => ({
				from: () => ({
					where: (condition: unknown) => {
						const strings = new Set(collectStrings(condition));
						const filtered = rows.filter((row) => {
							if (row.teamId === "litellm-dashboard") {
								return false;
							}
							if (strings.has(String(row.userId))) {
								return true;
							}
							if (strings.has(String(row.teamId))) {
								return true;
							}
							if (strings.has(String(row.organizationId))) {
								return true;
							}
							if (strings.has(String(row.token))) {
								return true;
							}
							if (strings.has(String(row.keyAlias))) {
								return true;
							}
							return strings.size <= 2;
						});
						return Promise.resolve(filtered);
					},
				}),
			}),
		};
	}

	function makeKeyAliasesMockDb(rows: Array<Record<string, unknown>>): unknown {
		return {
			select: () => ({
				from: () => ({
					where: () => Promise.resolve(rows),
				}),
			}),
		};
	}

	it("GET /key/info?key=<hash> 返回 Python shape 且不泄漏 token", async () => {
		const hashed = "hashed-info-token";
		const app = makeApp(makeKeyInfoMockDb([{ token: hashed, keyAlias: "alias", userId: "user-a" }]));

		const res = await request(app).get(`/key/info?key=${hashed}`);

		expect(res.status).toBe(200);
		expect(res.body.key).toBe(hashed);
		expect(res.body.info).toMatchObject({ key_alias: "alias", user_id: "user-a" });
		expect(JSON.stringify(res.body)).not.toContain('"token"');
	});

	it("GET /key/info?key=sk-* 先 hash 后查询，响应 key 保留原请求", async () => {
		const plain = "sk-plain-info-key";
		const hashed = hashApiKey(plain);
		const app = makeApp(makeKeyInfoMockDb([{ token: hashed, keyAlias: "plain-alias" }]));

		const res = await request(app).get(`/key/info?key=${plain}`);

		expect(res.status).toBe(200);
		expect(res.body.key).toBe(plain);
		expect(res.body.info.key_alias).toBe("plain-alias");
		expect(JSON.stringify(res.body.info)).not.toContain(hashed);
	});

	it("POST /key/info 保持兼容 shape 但 data 不含 token", async () => {
		const hashed = "hashed-post-info";
		const app = makeApp(makeKeyInfoMockDb([{ token: hashed, keyName: "sk-...post" }]));

		const res = await request(app).post("/key/info").send({ token: hashed });

		expect(res.status).toBe(200);
		expect(res.body.success).toBe(true);
		expect(res.body.data.key_name).toBe("sk-...post");
		expect(res.body.data.token).toBeUndefined();
	});

	it("POST /v2/key/info 支持 sk-* hash 查询，响应回显原 keys 且 info 去 token", async () => {
		const plain = "sk-v2-info-key";
		const hashed = hashApiKey(plain);
		const app = makeApp(makeKeyInfoMockDb([{ token: hashed, keyAlias: "v2-alias" }]));

		const res = await request(app)
			.post("/v2/key/info")
			.send({ keys: [plain] });

		expect(res.status).toBe(200);
		expect(res.body.key).toEqual([plain]);
		expect(res.body.info[0].key_alias).toBe("v2-alias");
		expect(res.body.info[0].token).toBeUndefined();
	});

	it("/key/aliases 返回 Logs 过滤器所需的可搜索分页契约，并排除空 alias 与 WebUI session key", async () => {
		const rows = [
			{ token: "hash-zulu", keyAlias: "zulu", teamId: "team-a" },
			{ token: "hash-alpha", keyAlias: "Alpha One", teamId: "team-a" },
			{ token: "hash-bravo", keyAlias: "bravo", teamId: "team-b" },
			{ token: "hash-empty", keyAlias: "", teamId: "team-a" },
			{ token: "hash-null", keyAlias: null, teamId: "team-a" },
			{ token: "hash-session", keyAlias: "dashboard-session", teamId: "litellm-dashboard" },
		];
		const app = makeApp(makeKeyAliasesMockDb(rows));

		const firstPage = await request(app).get("/key/aliases?page=1&size=2");
		expect(firstPage.status).toBe(200);
		expect(firstPage.body).toEqual({
			aliases: ["Alpha One", "bravo"],
			total_count: 3,
			current_page: 1,
			total_pages: 2,
			size: 2,
		});

		const searched = await request(app).get("/key/aliases?search=alpha");
		expect(searched.status).toBe(200);
		expect(searched.body).toEqual({
			aliases: ["Alpha One"],
			total_count: 1,
			current_page: 1,
			total_pages: 1,
			size: 50,
		});

		const empty = await request(app).get("/key/aliases?search=missing");
		expect(empty.status).toBe(200);
		expect(empty.body.total_count).toBe(0);
		expect(empty.body.total_pages).toBe(0);
		expect(empty.body.aliases).toEqual([]);
	});

	it("/key/list 默认 size=10，支持过滤、排序、状态，return_full_object 返回数据库 hash token 而不泄露明文 key", async () => {
		const plainKey = "sk-list-fixture-plain-key";
		const hashedToken = hashApiKey(plainKey);
		const rows = Array.from({ length: 12 }, (_, index) => ({
			token: index === 0 ? hashedToken : `hashed-list-${index}`,
			keyAlias: `alias-${index}`,
			keyName: `sk-...${index}`,
			userId: index % 2 === 0 ? "user-a" : "user-b",
			teamId: index === 11 ? "litellm-dashboard" : "team-a",
			organizationId: "org-a",
			projectId: "project-a",
			accessGroupIds: ["access-a"],
			blocked: index === 2,
			createdAt: new Date(`2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`),
		}));
		const app = makeApp(makeKeyListMockDb(rows));

		const page = await request(app).get("/key/list");
		expect(page.status).toBe(200);
		expect(page.body.keys).toHaveLength(10);
		expect(page.body.total_count).toBe(11);

		const filtered = await request(app).get(
			"/key/list?user_id=user-a&status=active&sort_by=created_at&sort_order=desc&return_full_object=true",
		);
		expect(filtered.status).toBe(200);
		expect(filtered.body.keys.length).toBeGreaterThan(0);
		expect(filtered.body.keys[0].created_at).toBe("2026-01-11T00:00:00.000Z");
		expect(filtered.body.keys.some((row: { key_alias: string }) => row.key_alias === "alias-2")).toBe(false);
		expect(filtered.body.keys[0].token).toMatch(/^hashed-list-/);

		const fullObject = await request(app).get("/key/list?return_full_object=true");
		expect(fullObject.status).toBe(200);
		expect(fullObject.body.keys).toEqual(expect.arrayContaining([expect.objectContaining({ token: hashedToken })]));
		expect(JSON.stringify(fullObject.body)).not.toContain(plainKey);
	});

	it("/key/list?status=deleted 从审计表返回 hash token 与删除元数据，不返回明文 key", async () => {
		const plain = "sk-deleted-plain-key";
		const hashed = hashApiKey(plain);
		const app = makeApp(
			makeKeyListMockDb([
				{
					token: hashed,
					keyAlias: "deleted-alias",
					userId: "user-a",
					teamId: null,
					deletedAt: new Date("2026-07-01T00:00:00.000Z"),
					deletedBy: "admin-a",
				},
			]),
		);

		const res = await request(app).get("/key/list?status=deleted&return_full_object=true");
		expect(res.status).toBe(200);
		expect(res.body.keys[0]).toMatchObject({
			token: hashed,
			key_alias: "deleted-alias",
			deleted_at: "2026-07-01T00:00:00.000Z",
			deleted_by: "admin-a",
		});
		expect(JSON.stringify(res.body)).not.toContain(plain);
	});
});

describe("KeyManagement /key/update Python 字段集契约", () => {
	const PYTHON_KEY_UPDATE_FIELDS = [
		"key",
		"token",
		"key_name",
		"key_alias",
		"soft_budget_cooldown",
		"spend",
		"expires",
		"models",
		"aliases",
		"config",
		"router_settings",
		"user_id",
		"team_id",
		"agent_id",
		"project_id",
		"permissions",
		"max_parallel_requests",
		"metadata",
		"blocked",
		"tpm_limit",
		"rpm_limit",
		"max_budget",
		"budget_duration",
		"budget_reset_at",
		"allowed_cache_controls",
		"allowed_routes",
		"policies",
		"access_group_ids",
		"model_spend",
		"model_max_budget",
		"budget_id",
		"organization_id",
		"object_permission_id",
		"created_at",
		"created_by",
		"updated_at",
		"updated_by",
		"last_active",
		"rotation_count",
		"auto_rotate",
		"rotation_interval",
		"last_rotation_at",
		"key_rotation_at",
		"litellm_budget_table",
		"litellm_organization_table",
		"litellm_project_table",
		"object_permission",
		"jwt_key_mappings",
	];

	function makeKeyUpdateMockDb(row: Record<string, unknown>): { db: unknown; updateCalls: Record<string, unknown>[] } {
		const updateCalls: Record<string, unknown>[] = [];
		const db = {
			select: () => ({
				from: () => ({
					where: () => ({
						limit: () => Promise.resolve([row]),
					}),
				}),
			}),
			update: () => ({
				set: (values: Record<string, unknown>) => {
					updateCalls.push(values);
					return { where: () => Promise.resolve({ rowCount: 1 }) };
				},
			}),
		};
		return { db: db, updateCalls: updateCalls };
	}

	it("返回 { key: 原请求 key, ...完整 key 对象（48 键） }，max_budget 已更新", async () => {
		const plain = "sk-update-target-key";
		const hashed = hashApiKey(plain);
		const { db } = makeKeyUpdateMockDb({
			token: hashed,
			keyName: "sk-...-key",
			keyAlias: "alias-u",
			softBudgetCooldown: false,
			spend: 0,
			expires: null,
			models: [],
			aliases: {},
			config: {},
			routerSettings: {},
			userId: null,
			teamId: null,
			agentId: null,
			projectId: null,
			permissions: {},
			maxParallelRequests: null,
			metadata: {},
			blocked: null,
			tpmLimit: null,
			rpmLimit: null,
			maxBudget: 5,
			budgetDuration: null,
			budgetResetAt: null,
			allowedCacheControls: [],
			allowedRoutes: [],
			policies: [],
			accessGroupIds: [],
			modelSpend: {},
			modelMaxBudget: {},
			budgetId: null,
			organizationId: null,
			objectPermissionId: null,
			createdAt: null,
			createdBy: null,
			updatedAt: null,
			updatedBy: null,
			lastActive: null,
			rotationCount: 0,
			autoRotate: false,
			rotationInterval: null,
			lastRotationAt: null,
			keyRotationAt: null,
		});
		const app = makeApp(db);

		const res = await request(app).post("/key/update").send({ key: plain, max_budget: 5 });

		expect(res.status).toBe(200);
		expect(Object.keys(res.body).sort()).toEqual([...PYTHON_KEY_UPDATE_FIELDS].sort());
		expect(res.body.key).toBe(plain);
		expect(res.body.token).toBe(hashed);
		expect(res.body.max_budget).toBe(5);
		expect(res.body.soft_budget_cooldown).toBe(false);
		expect(res.body.rotation_count).toBe(0);
		expect(res.body.auto_rotate).toBe(false);
		expect(res.body.litellm_budget_table).toBeNull();
		expect(res.body.jwt_key_mappings).toBeNull();
	});

	it("key 不存在时返回 404", async () => {
		const db = {
			select: () => ({
				from: () => ({
					where: () => ({
						limit: () => Promise.resolve([]),
					}),
				}),
			}),
		};
		const app = makeApp(db);

		const res = await request(app).post("/key/update").send({ key: "sk-nonexistent", max_budget: 1 });

		expect(res.status).toBe(404);
		expect(res.body.error.message).toBe("Key not found");
	});
});

describe("KeyManagement /key/generate Python 字段集契约", () => {
	const PYTHON_RESPONSE_FIELDS = [
		"key_alias",
		"duration",
		"models",
		"spend",
		"max_budget",
		"user_id",
		"team_id",
		"agent_id",
		"max_parallel_requests",
		"metadata",
		"tpm_limit",
		"rpm_limit",
		"budget_duration",
		"allowed_cache_controls",
		"config",
		"permissions",
		"model_max_budget",
		"model_rpm_limit",
		"model_tpm_limit",
		"guardrails",
		"policies",
		"prompts",
		"blocked",
		"aliases",
		"object_permission",
		"key",
		"budget_id",
		"tags",
		"enforced_params",
		"allowed_routes",
		"allowed_passthrough_routes",
		"allowed_vector_store_indexes",
		"rpm_limit_type",
		"tpm_limit_type",
		"router_settings",
		"access_group_ids",
		"key_name",
		"expires",
		"token_id",
		"organization_id",
		"project_id",
		"litellm_budget_table",
		"token",
		"created_by",
		"updated_by",
		"created_at",
		"updated_at",
	];

	function makeGenerateMockDb(): { db: unknown; inserted: Record<string, unknown>[] } {
		const inserted: Record<string, unknown>[] = [];
		const db = {
			select: () => ({
				from: () => ({
					where: () => ({
						limit: () => Promise.resolve([]),
					}),
				}),
			}),
			insert: () => ({
				values: (values: Record<string, unknown>) => {
					inserted.push(values);
					return Promise.resolve();
				},
			}),
		};
		return { db: db, inserted: inserted };
	}

	it("返回 Python GenerateKeyResponse 完整字段集（无 success 包装）", async () => {
		const { db, inserted } = makeGenerateMockDb();
		const app = makeApp(db);

		const res = await request(app)
			.post("/key/generate")
			.send({ models: ["x"], max_budget: 1 });

		expect(res.status).toBe(200);
		expect(res.body.success).toBeUndefined();
		for (const field of PYTHON_RESPONSE_FIELDS) {
			expect(res.body).toHaveProperty(field);
		}
		expect(res.body.models).toEqual(["x"]);
		expect(res.body.max_budget).toBe(1);
		expect(res.body.spend).toBe(0);
		expect(res.body.metadata).toEqual({});
		expect(res.body.aliases).toEqual({});
		expect(res.body.config).toEqual({});
		expect(res.body.permissions).toEqual({});
		expect(res.body.model_max_budget).toEqual({});
		expect(res.body.allowed_routes).toEqual([]);
		expect(res.body.allowed_cache_controls).toEqual([]);
		expect(res.body.access_group_ids).toEqual([]);
		expect(res.body.blocked).toBeNull();
		expect(res.body.policies).toBeNull();
		expect(res.body.litellm_budget_table).toBeNull();
		// key/key_name/token 联动：token_id 是明文 key 的 hash；key_name 缺省为 "sk-..." + 明文后 4 位
		const plainKey = res.body.key as string;
		expect(plainKey.startsWith("sk-")).toBe(true);
		expect(res.body.token_id).toBe(hashApiKey(plainKey));
		expect(res.body.token).toBe(res.body.token_id);
		expect(res.body.key_name).toBe(`sk-...${plainKey.slice(-4)}`);
		expect(res.body.created_by).toBe("default_user_id");
		expect(res.body.updated_by).toBe("default_user_id");
		// router_settings 展开为 Python UpdateRouterConfig 缺省形态
		expect(res.body.router_settings).toMatchObject({ model_group_alias: {}, routing_strategy: null, num_retries: null });
		// DB 落库：token 存 hash，keyName 存掩码
		expect(inserted[0]?.token).toBe(res.body.token_id);
		expect(inserted[0]?.keyName).toBe(res.body.key_name);
		expect(inserted[0]?.blocked).toBe(false);
	});

	it("显式 key_name/created_by 优先；duration 换算 expires", async () => {
		const { db } = makeGenerateMockDb();
		const app = makeApp(db);

		const res = await request(app).post("/key/generate").send({ key_name: "my-key", duration: "1h", team_id: "team-a" });

		expect(res.status).toBe(200);
		expect(res.body.key_name).toBe("my-key");
		expect(res.body.duration).toBe("1h");
		expect(res.body.team_id).toBe("team-a");
		const expires = new Date(res.body.expires as string).getTime();
		expect(expires).toBeGreaterThan(Date.now() + 59 * 60 * 1000);
		expect(expires).toBeLessThanOrEqual(Date.now() + 61 * 60 * 1000);
	});

	it("显式自定义 key 时返回该明文并仅将 hash 落库", async () => {
		const { db, inserted } = makeGenerateMockDb();
		const app = makeApp(db);
		const customKey = "sk-custom-key-123456";

		const res = await request(app).post("/key/generate").send({ key: customKey });

		expect(res.status).toBe(200);
		expect(res.body.key).toBe(customKey);
		expect(res.body.token_id).toBe(hashApiKey(customKey));
		expect(res.body.key_name).toBe(`sk-...${customKey.slice(-4)}`);
		expect(inserted[0]?.token).toBe(hashApiKey(customKey));
		expect(inserted[0]?.token).not.toBe(customKey);
	});

	it("key 为空白时继续自动生成", async () => {
		const { db } = makeGenerateMockDb();
		const app = makeApp(db);

		const res = await request(app).post("/key/generate").send({ key: "   " });

		expect(res.status).toBe(200);
		expect(res.body.key).toMatch(/^sk-/);
		expect(res.body.key).not.toBe("   ");
		expect(res.body.token_id).toBe(hashApiKey(res.body.key as string));
	});

	it.each([
		["缺少 sk- 前缀", "custom-key-123456", "must start with 'sk-'"],
		["长度不足", "sk-short", "at least 16 characters"],
	])("拒绝%s的自定义 key", async (_label, key, expectedMessage) => {
		const { db } = makeGenerateMockDb();
		const app = makeApp(db);

		const res = await request(app).post("/key/generate").send({ key });

		expect(res.status).toBe(400);
		expect(res.body.error.message).toContain(expectedMessage);
	});

	it("非法 duration 返回 400 标准错误格式", async () => {
		const { db } = makeGenerateMockDb();
		const app = makeApp(db);

		const res = await request(app).post("/key/generate").send({ duration: "abc" });

		expect(res.status).toBe(400);
		expect(res.body.error.message).toContain("Invalid duration format");
	});
});
