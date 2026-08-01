import { ApiError } from "../core/api/ApiError";
import type { ConfigRepository } from "../repositories/ConfigRepository";
import {
	buildCliProxyProjection,
	compareCliProxyVersions,
	extractCliProxyReleaseNotes,
	parseCliProxyUserConfig,
	serializeCliProxyUserConfig,
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

describe("CLIProxy release comparison", () => {
	it.each([
		["7.2.110", "7.2.110", 0],
		["7.2.111", "7.2.110", 1],
		["7.2.109", "7.2.110", -1],
		["7.2.110", "7.2.110-rc.1", 1],
		["7.2.110-rc.2", "7.2.110-rc.10", -1],
	])("compares %s with %s", (left, right, expected) => {
		expect(compareCliProxyVersions(left, right)).toBe(expected);
	});

	it("extracts the version changelog instead of repeated release asset documentation", () => {
		expect(
			extractCliProxyReleaseNotes(`
## Linux release assets

- Portable build details

## Changelog

- feat: add a new model
- fix: refresh credentials

## What's Changed

- Pull request metadata
`),
		).toBe("- feat: add a new model\n- fix: refresh credentials");
	});

	it("returns release notes for every stable version from the GitHub response", async () => {
		jest.spyOn(global, "fetch").mockResolvedValueOnce(
			new Response(
				JSON.stringify([
					{
						tag_name: "v7.2.112",
						published_at: "2026-07-31T08:39:29Z",
						html_url: "https://github.com/router-for-me/CLIProxyAPI/releases/tag/v7.2.112",
						body: "## Changelog\n\n- newest change",
						draft: false,
						prerelease: false,
					},
					{
						tag_name: "v7.2.111",
						published_at: "2026-07-30T18:56:58Z",
						html_url: "https://github.com/router-for-me/CLIProxyAPI/releases/tag/v7.2.111",
						body: "## Changelog\n\n- earlier change",
						draft: false,
						prerelease: false,
					},
					{
						tag_name: "v7.2.113-rc.1",
						body: "## Changelog\n\n- prerelease change",
						draft: false,
						prerelease: true,
					},
				]),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			),
		);
		const runtime = new CliProxyRuntimeManager({} as ConfigRepository, "master-key-for-test");

		await expect(runtime.checkLatestVersion()).resolves.toMatchObject({
			latest: "7.2.112",
			update_available: true,
			releases: [
				{ version: "7.2.112", notes: "- newest change" },
				{ version: "7.2.111", notes: "- earlier change" },
			],
		});
		expect(global.fetch).toHaveBeenCalledWith(
			"https://api.github.com/repos/router-for-me/CLIProxyAPI/releases?per_page=100",
			expect.any(Object),
		);
		jest.restoreAllMocks();
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
			calls.push({ url, init });
			if (url.includes("/auth-files")) {
				return new Response(
					JSON.stringify({
						files: [
							{
								name: "codex-user.json",
								auth_index: "auth-index-1",
								type: "codex",
								email: "user@example.com",
								chatgpt_account_id: "chatgpt-account-1",
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
			header: expect.objectContaining({ Authorization: "Bearer $TOKEN$" }),
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
