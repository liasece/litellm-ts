import { ApiError } from "../core/api/ApiError";
import type { ConfigRepository } from "../repositories/ConfigRepository";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
	buildCliProxyProjection,
	extractManagedCommandCodeAccounts,
	commandCodeAccountFilename,
	parseCliProxyUserConfig,
	serializeCliProxyUserConfig,
	stripManagedCliProxyAccounts,
} from "./CliProxyRuntimeManager";
import { CliProxyRuntimeManager } from "./CliProxyRuntimeManager";

describe("CLIProxy managed config projection", () => {
	it("keeps feature settings while forcing the runtime onto the private internal boundary", () => {
		const userConfig = parseCliProxyUserConfig(`
debug: true
routing:
  strategy: weighted-round-robin
request-retry: 4
`);
		const projected = buildCliProxyProjection(userConfig, {
			port: 8317,
			authDir: "/state/auths",
			internalApiKey: "internal-only",
		});

		expect(projected).toMatchObject({
			debug: true,
			routing: { strategy: "weighted-round-robin" },
			"request-retry": 4,
			host: "127.0.0.1",
			port: 8317,
			"auth-dir": "/state/auths",
			"api-keys": ["internal-only"],
			"logging-to-file": false,
			"remote-management": {
				"allow-remote": false,
				"secret-key": "",
				"disable-control-panel": true,
			},
		});
	});

	it.each(["host: 0.0.0.0", "port: 9000", "auth-dir: /tmp/auth", "api-keys: [public]", "remote-management: {}"])(
		"rejects user control of reserved runtime config: %s",
		(source) => {
			expect(() => parseCliProxyUserConfig(source)).toThrow(ApiError);
		},
	);

	it("serializes visual config without dropping nested or unknown feature settings", () => {
		const source = serializeCliProxyUserConfig({
			debug: true,
			routing: { strategy: "fill-first", "session-affinity": true },
			"future-feature": { enabled: true },
		});

		expect(parseCliProxyUserConfig(source)).toEqual({
			debug: true,
			routing: { strategy: "fill-first", "session-affinity": true },
			"future-feature": { enabled: true },
		});
		expect(() => serializeCliProxyUserConfig({ host: "0.0.0.0" })).toThrow(ApiError);
	});
});

describe("CLIProxy drain status", () => {
	it("exposes the drain flag and the in-flight count on the runtime status", async () => {
		const { beginCliProxyDrain, endCliProxyDrain, resetCliProxyDrainGateForTest, trackCliProxyRequest } = await import(
			"./CliProxyDrainGate"
		);
		resetCliProxyDrainGateForTest();
		const runtime = new CliProxyRuntimeManager({} as ConfigRepository, "master-key-for-test");
		runtime.setActiveRequestProbe(() => 2);
		expect(runtime.status()).toMatchObject({ draining: false, in_flight_requests: 2 });
		const release = trackCliProxyRequest();
		beginCliProxyDrain();
		try {
			expect(runtime.status()).toMatchObject({ draining: true, in_flight_requests: 3 });
		} finally {
			release();
			endCliProxyDrain();
			resetCliProxyDrainGateForTest();
		}
	});
});

describe("CLIProxy managed CommandCode accounts", () => {
	it("reads both the legacy single-object form and the array form", () => {
		expect(
			extractManagedCommandCodeAccounts({
				plugins: { "managed-accounts": { commandcode: { "api-key": "cc_secret", label: "GOAT" } } },
			}),
		).toEqual([{ apiKey: "cc_secret", label: "GOAT" }]);
		expect(
			extractManagedCommandCodeAccounts({
				plugins: {
					"managed-accounts": {
						commandcode: [{ "api-key": "cc_a", label: "A" }, { "api-key": "cc_b" }, { "api-key": "   " }],
					},
				},
			}),
		).toEqual([
			{ apiKey: "cc_a", label: "A" },
			{ apiKey: "cc_b", label: "CommandCode" },
		]);
	});

	it("derives a stable auth filename per key", () => {
		expect(commandCodeAccountFilename("cc_secret")).toMatch(/^commandcode-managed-[0-9a-f]{12}\.json$/);
		expect(commandCodeAccountFilename(" cc_secret ")).toBe(commandCodeAccountFilename("cc_secret"));
		expect(commandCodeAccountFilename("cc_secret")).not.toBe(commandCodeAccountFilename("cc_other"));
	});

	it("strips managed accounts without touching other plugin config", () => {
		const stripped = stripManagedCliProxyAccounts({
			debug: true,
			plugins: {
				"managed-accounts": { commandcode: { "api-key": "cc_secret" } },
				configs: { "opencode-go-cliproxyapi": { enabled: true } },
			},
		});

		expect(stripped["debug"]).toBe(true);
		expect(JSON.stringify(stripped)).not.toContain("cc_secret");
		expect((stripped["plugins"] as Record<string, unknown>)["configs"]).toEqual({ "opencode-go-cliproxyapi": { enabled: true } });
	});

	it("never projects the managed account secret into the CPA config", () => {
		const projected = buildCliProxyProjection(
			{ plugins: { "managed-accounts": { commandcode: { "api-key": "cc_secret", label: "GOAT" } } } },
			{
				port: 8317,
				authDir: "/state/auths",
				internalApiKey: "internal-only",
				plugins: { dir: "/opt/cliproxy/plugins", opencodeGo: false, commandcode: true },
			},
		);

		expect(JSON.stringify(projected)).not.toContain("cc_secret");
		const plugins = projected["plugins"] as Record<string, unknown>;
		expect(plugins["managed-accounts"]).toBeUndefined();
		expect(plugins["configs"]).toEqual({
			"commandcode-go-cliproxyapi": {
				enabled: true,
				"base-url": "https://api.commandcode.ai/provider/v1",
				"model-prefix": { enabled: true, value: "commandcode" },
			},
		});
	});
});

describe("CLIProxy managed OpenCode Go plugin", () => {
	it("enables the managed plugin inside the managed runtime boundary", () => {
		const projected = buildCliProxyProjection(
			{},
			{
				port: 8317,
				authDir: "/state/auths",
				internalApiKey: "internal-only",
				plugins: { dir: "/opt/cliproxy/plugins", opencodeGo: true, commandcode: false },
			},
		);

		expect(projected["plugins"]).toEqual({
			enabled: true,
			dir: "/opt/cliproxy/plugins",
			configs: {
				"opencode-go-cliproxyapi": {
					enabled: true,
					"base-url": "https://opencode.ai/inference/go/v1",
					"model-prefix": { enabled: true, value: "opencode-go" },
					"api-keys": [{ value: "${OPENCODE_GO_API_KEY}", name: "Personal" }],
				},
			},
		});
	});

	it("lets the page override the plugin credential while keeping the managed directory", () => {
		const projected = buildCliProxyProjection(
			{
				plugins: {
					configs: {
						"opencode-go-cliproxyapi": { "api-keys": [{ value: "oc_sk_from_page" }] },
					},
				},
			},
			{
				port: 8317,
				authDir: "/state/auths",
				internalApiKey: "internal-only",
				plugins: { dir: "/opt/cliproxy/plugins", opencodeGo: true, commandcode: false },
			},
		);

		expect(projected["plugins"]).toMatchObject({
			enabled: true,
			dir: "/opt/cliproxy/plugins",
			configs: { "opencode-go-cliproxyapi": { "api-keys": [{ value: "oc_sk_from_page" }] } },
		});
	});

	it("enables the Command Code plugin without an OpenCode key", () => {
		const projected = buildCliProxyProjection(
			{},
			{
				port: 8317,
				authDir: "/state/auths",
				internalApiKey: "internal-only",
				plugins: { dir: "/opt/cliproxy/plugins", opencodeGo: false, commandcode: true },
			},
		);

		expect(projected["plugins"]).toEqual({
			enabled: true,
			dir: "/opt/cliproxy/plugins",
			configs: {
				"commandcode-go-cliproxyapi": {
					enabled: true,
					"base-url": "https://api.commandcode.ai/provider/v1",
					"model-prefix": { enabled: true, value: "commandcode" },
				},
			},
		});
	});

	it("keeps both managed plugins in one config", () => {
		const projected = buildCliProxyProjection(
			{},
			{
				port: 8317,
				authDir: "/state/auths",
				internalApiKey: "internal-only",
				plugins: { dir: "/opt/cliproxy/plugins", opencodeGo: true, commandcode: true },
			},
		);

		const plugins = projected["plugins"] as { configs: Record<string, unknown> };
		expect(Object.keys(plugins.configs).sort()).toEqual(["commandcode-go-cliproxyapi", "opencode-go-cliproxyapi"]);
	});

	it("leaves configuration untouched when the runtime does not ship the plugin", () => {
		const projected = buildCliProxyProjection({}, { port: 8317, authDir: "/state/auths", internalApiKey: "internal-only" });

		expect(projected).not.toHaveProperty("plugins");
	});

});

describe("CLIProxy plugin subscription quota", () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("routes provider-plugin quotas through the management quota API", async () => {
		jest.spyOn(global, "fetch").mockImplementation(async (input) => {
			const url = String(input);
			if (url.includes("/auth-files")) {
				return Response.json({ files: [{ name: "opencode-go.json", auth_index: "oi-1", provider: "opencode-go" }] });
			}
			if (url.includes("/quota/providers")) {
				return Response.json({ providers: [{ provider: "opencode-go", supported_providers: ["opencode-go"] }] });
			}
			if (url.includes("/quota/fetch")) {
				return Response.json({
					subscription: { plan: "Go" },
					groups: [
						{
							displayName: "OpenCode Go",
							buckets: [
								{ window: "rolling", remainingFraction: 0.8, resetTime: "2026-10-29T10:00:00Z" },
								{ window: "weekly", remainingFraction: 0.5 },
							],
						},
					],
				});
			}
			return new Response("{}", { status: 404 });
		});
		const runtime = new CliProxyRuntimeManager({} as ConfigRepository, "master-key-for-test");

		const quota = await runtime.getAccountQuota("oi-1");

		expect(quota.provider).toBe("opencode-go");
		expect(quota.plan).toBe("Go");
		expect(quota.windows).toEqual([
			expect.objectContaining({ label: "5 小时", used_percent: 20, remaining_percent: 80 }),
			expect.objectContaining({ label: "周", remaining_percent: 50 }),
		]);
	});

	it("routes CommandCode account quotas through the plugin management API", async () => {
		const calls: Array<{ url: string; body?: string }> = [];
		jest.spyOn(global, "fetch").mockImplementation(async (input, init) => {
			const url = String(input);
			calls.push({ url: url, body: typeof init?.body === "string" ? init.body : undefined });
			if (url.includes("/auth-files")) {
				return Response.json({ files: [{ name: "commandcode.json", auth_index: "cc-1", provider: "commandcode" }] });
			}
			if (url.includes("/plugins/commandcode-go-cliproxyapi/quota-usage")) {
				return Response.json({
					cards: [
						{
							key_id: "cc-1",
							usage: {
								plan: "GOAT",
								plan_credits: 70,
								credits_left: 60,
								five_hour: { percent: 10 },
								weekly: { percent: 20 },
							},
						},
					],
				});
			}
			return new Response("{}", { status: 404 });
		});
		const runtime = new CliProxyRuntimeManager({} as ConfigRepository, "master-key-for-test");

		const quota = await runtime.getAccountQuota("cc-1");

		expect(quota.provider).toBe("commandcode");
		expect(quota.plan).toBe("GOAT");
		expect(quota.windows.map((window) => window.label)).toEqual(["5 小时", "周"]);
		const quotaCall = calls.find((call) => call.url.includes("quota-usage"));
		expect(JSON.parse(String(quotaCall?.body))).toEqual({ key_id: "cc-1" });
	});
});

describe("CLIProxy managed quota transport", () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("uses the private management credential and auth_index without exposing OAuth tokens", async () => {
		const calls: Array<{ url: string; init?: RequestInit }> = [];
		jest.spyOn(global, "fetch").mockImplementation(async (input, init) => {
			const url = String(input);
			calls.push({ url: url, init: init });
			if (url.includes("/auth-files")) {
				return new Response(
					JSON.stringify({
						files: [
							{
								name: "codex-user.json",
								auth_index: "auth-index-1",
								type: "codex",
								email: "user@example.com",
								id_token: { chatgpt_account_id: "chatgpt-account-1" },
							},
						],
					}),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			return new Response(
				JSON.stringify({
					status_code: 200,
					body: JSON.stringify({
						plan_type: "plus",
						rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 18_000 } },
					}),
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		});
		const runtime = new CliProxyRuntimeManager({} as ConfigRepository, "master-key-for-test");

		const quota = await runtime.getAccountQuota("auth-index-1");

		expect(quota).toMatchObject({
			provider: "codex",
			plan: "plus",
			windows: [expect.objectContaining({ remaining_percent: 90 })],
		});
		expect(calls).toHaveLength(2);
		expect(calls[0]?.url).toContain("/v0/management/auth-files?auth_index=auth-index-1");
		const managementHeader = new Headers(calls[0]?.init?.headers).get("authorization");
		expect(managementHeader).toMatch(/^Bearer cpm-/);
		expect(managementHeader).not.toContain("master-key-for-test");
		const apiCallBody = JSON.parse(String(calls[1]?.init?.body)) as Record<string, unknown>;
		expect(apiCallBody).toMatchObject({
			auth_index: "auth-index-1",
			method: "GET",
			url: "https://chatgpt.com/backend-api/wham/usage",
			header: expect.objectContaining({ Authorization: "Bearer $TOKEN$", "Chatgpt-Account-Id": "chatgpt-account-1" }),
		});
		expect(JSON.stringify(quota)).not.toMatch(/access_token|master-key-for-test|cpm-/);
	});

	it("preserves an explicit multipart boundary while adding the private management credential", async () => {
		const fetchSpy = jest.spyOn(global, "fetch").mockResolvedValue(Response.json({ status: "ok" }));
		const runtime = new CliProxyRuntimeManager({} as ConfigRepository, "master-key-for-test");

		await runtime.managementRequest("/auth-files", {
			method: "POST",
			headers: { "Content-Type": "multipart/form-data; boundary=test-boundary" },
			body: Buffer.from("--test-boundary--"),
		});

		const headers = new Headers(fetchSpy.mock.calls[0]?.[1]?.headers);
		expect(headers.get("content-type")).toBe("multipart/form-data; boundary=test-boundary");
		expect(headers.get("authorization")).toMatch(/^Bearer cpm-/);
	});

	it("does not leak an upstream error body", async () => {
		jest.spyOn(global, "fetch").mockImplementation(async (input) => {
			if (String(input).includes("/auth-files")) {
				return new Response(JSON.stringify({ files: [{ name: "codex.json", auth_index: "auth-1", type: "codex" }] }), {
					status: 200,
				});
			}
			return new Response(JSON.stringify({ status_code: 401, body: "sensitive upstream token detail" }), { status: 200 });
		});
		const runtime = new CliProxyRuntimeManager({} as ConfigRepository, "master-key-for-test");

		await expect(runtime.getAccountQuota("auth-1")).rejects.toMatchObject({
			statusCode: 503,
			message: "codex 订阅额度查询失败: HTTP 401",
		});
	});
});

describe("CLIProxy OAuth account trash/restore", () => {
	let runtimeRoot: string;
	let authDir: string;
	let previousRuntimeRoot: string | undefined;

	beforeEach(async () => {
		runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cliproxy-test-"));
		authDir = path.join(runtimeRoot, "auths");
		await fs.mkdir(authDir, { recursive: true });
		previousRuntimeRoot = process.env["CLIPROXY_RUNTIME_ROOT"];
		process.env["CLIPROXY_RUNTIME_ROOT"] = runtimeRoot;
	});

	afterEach(async () => {
		if (previousRuntimeRoot === undefined) {
			delete process.env["CLIPROXY_RUNTIME_ROOT"];
		} else {
			process.env["CLIPROXY_RUNTIME_ROOT"] = previousRuntimeRoot;
		}
		await fs.rm(runtimeRoot, { recursive: true, force: true });
	});

	it.each(["commandcode", "opencode-go"] as const)("preserves %s account identity, settings and revocation across a restart", async provider => {
		const config = new Map<string, Record<string, unknown>>([["cliproxy_settings", { enabled: false, config_yaml: "" }]]);
		const repository = {
			getParam: async (name: string) => config.get(name),
			upsertParam: async (name: string, value: Record<string, unknown>) => { config.set(name, structuredClone(value)); },
		} as unknown as ConfigRepository;
		const runtime = new CliProxyRuntimeManager(repository, "fixture-vault-key");
		await runtime.initialize();
		const [account] = await runtime.saveSubscriptionKey(provider, undefined, "Primary", "fixture-one");
		const filename = "subscription-" + provider + "-" + account!.id + ".json";
		const file = path.join(authDir, filename);
		expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
		await runtime.updateAccount(filename, { disabled: true, weight: 3 });
		await runtime.saveSubscriptionKey(provider, account!.id, "Renamed", "fixture-two");
		expect(JSON.parse(await fs.readFile(file, "utf8"))).toMatchObject({ api_key: "fixture-two", label: "Renamed", disabled: true, weight: 3 });
		expect(JSON.stringify([...config.values()])).not.toContain("fixture-two");
		await runtime.revokeSubscriptionKey(provider, account!.id);
		expect(await runtime.listSavedKeys(provider)).toEqual([]);
		const reopened = new CliProxyRuntimeManager(repository, "fixture-vault-key");
		await reopened.initialize();
		expect(await reopened.listSavedKeys(provider)).toEqual([]);
		await expect(fs.stat(file)).rejects.toMatchObject({code: "ENOENT"});
		const [archived] = await fs.readdir(path.join(authDir, ".trash"));
		await reopened.restoreAccount(".trash/" + archived);
		expect(await reopened.listSavedKeys(provider)).toEqual([{ id: account!.id, provider: provider, label: "Renamed" }]);
		expect(JSON.parse(await fs.readFile(file, "utf8"))).toMatchObject({ api_key: "fixture-two", disabled: true, weight: 3 });
	});

	it("trashAccount 把文件移入 .trash 并加时间戳前缀", async () => {
		await fs.writeFile(path.join(authDir, "codex-foo.json"), "{}");
		const runtime = new CliProxyRuntimeManager({} as ConfigRepository, "master-key-for-test");

		await runtime.trashAccount("codex-foo.json");

		const authsEntries = await fs.readdir(authDir);
		expect(authsEntries).not.toContain("codex-foo.json");
		const trashEntries = await fs.readdir(path.join(authDir, ".trash"));
		expect(trashEntries).toHaveLength(1);
		expect(trashEntries[0]).toMatch(/^\d+-codex-foo\.json$/);
	});

	it("restoreAccount 把 trash 文件还原为原始文件名", async () => {
		await fs.mkdir(path.join(authDir, ".trash"), { recursive: true });
		await fs.writeFile(path.join(authDir, ".trash", "1786846264579-codex-foo.json"), "{}");
		const runtime = new CliProxyRuntimeManager({} as ConfigRepository, "master-key-for-test");

		await runtime.restoreAccount(".trash/1786846264579-codex-foo.json");

		const authsEntries = await fs.readdir(authDir);
		expect(authsEntries).toContain("codex-foo.json");
		const trashEntries = await fs.readdir(path.join(authDir, ".trash"));
		expect(trashEntries).toHaveLength(0);
	});

	it("restoreAccount 拒绝非 .trash 前缀路径", async () => {
		const runtime = new CliProxyRuntimeManager({} as ConfigRepository, "master-key-for-test");
		await expect(runtime.restoreAccount("codex-foo.json")).rejects.toMatchObject({ statusCode: 400 });
		await expect(runtime.restoreAccount("../etc/passwd")).rejects.toMatchObject({ statusCode: 400 });
	});

	it("restoreAccount 文件不存在时返回 404", async () => {
		const runtime = new CliProxyRuntimeManager({} as ConfigRepository, "master-key-for-test");
		await expect(runtime.restoreAccount(".trash/1786846264579-missing.json")).rejects.toMatchObject({ statusCode: 404 });
	});

	it("listAccounts 默认过滤 trash 文件，includeTrashed 时保留", async () => {
		jest.spyOn(global, "fetch").mockImplementation(
			async () =>
				new Response(
					JSON.stringify({
						files: [
							{ name: "codex-active.json", auth_index: "a1", type: "codex" },
							{ name: ".trash/1786846264579-codex-archived.json", auth_index: "a2", type: "codex" },
						],
					}),
					{ status: 200 },
				),
		);
		const runtime = new CliProxyRuntimeManager({} as ConfigRepository, "master-key-for-test");

		const active = await runtime.listAccounts();
		expect(active.map((a) => a.filename)).toEqual(["codex-active.json"]);

		const all = await runtime.listAccounts({ includeTrashed: true });
		expect(all.map((a) => a.filename)).toEqual([".trash/1786846264579-codex-archived.json", "codex-active.json"]);
	});
});
