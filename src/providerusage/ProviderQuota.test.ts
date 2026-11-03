import { parseMiniMaxTokenPlan, miniMaxQuotaHosts, fetchMiniMaxQuota } from "./MiniMaxQuota";
import { normalizeDeepSeekApiBase, parseDeepSeekBalance } from "./DeepSeekBalance";
import { buildQuotaTargets, ProviderQuotaService, resolveProvider } from "./ProviderQuotaService";
import type { Deployment } from "../types/router";

function deployment(modelName: string, params: Record<string, unknown>): Deployment {
	return {
		model_name: modelName,
		litellm_params: { model: "minimax/MiniMax-M3", ...params },
	};
}

describe("provider quota adapters", () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("reads MiniMax 5-hour and weekly windows from the real payload shape", () => {
		const parsed = parseMiniMaxTokenPlan({
			base_resp: { status_code: 0, status_msg: "" },
			model_remains: [
				{
					model_name: "general",
					current_interval_remaining_percent: 81,
					end_time: 1_792_699_200_000,
					current_weekly_remaining_percent: 42,
					weekly_end_time: 1_792_699_200_000,
					current_interval_usage_count: 0,
					current_interval_total_count: 0,
				},
			],
		});

		expect(parsed.windows).toEqual([
			expect.objectContaining({ id: "general-5h", label: "MiniMax · 5-hour", remaining_percent: 81, used_percent: 19 }),
			expect.objectContaining({ id: "general-weekly", label: "MiniMax · 7-day", remaining_percent: 42, used_percent: 58 }),
		]);
		expect(parsed.windows[0]?.resets_at).toBe(new Date(1_792_699_200_000).toISOString());
	});

	it("does not turn an unlimited MiniMax window into a 0% bar", () => {
		const parsed = parseMiniMaxTokenPlan({
			model_remains: [{ model_name: "general", current_interval_status: 3, current_interval_remaining_percent: 100 }],
		});

		expect(parsed.windows).toEqual([]);
	});

	it("prefers the configured MiniMax region but keeps documented fallbacks", () => {
		expect(miniMaxQuotaHosts("https://api.minimax.io/v1")[0]).toBe("https://api.minimax.io");
		expect(miniMaxQuotaHosts(undefined)).toContain("https://www.minimaxi.com");
	});

	it("detects a subscription key and skips the balance endpoint", async () => {
		const calls: string[] = [];
		jest.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			calls.push(String(input));
			return new Response(
				JSON.stringify({
					base_resp: { status_code: 0 },
					model_remains: [{ model_name: "general", current_interval_remaining_percent: 90 }],
				}),
				{ status: 200 },
			);
		});

		const result = await fetchMiniMaxQuota("subscription-key", "https://api.minimax.cn/v1");

		expect(result.accountKind).toBe("subscription");
		expect(calls).toHaveLength(1);
		expect(calls[0]).toContain("/v1/token_plan/remains");
	});

	it("falls back to a pay-as-you-go balance when the key has no subscription", async () => {
		jest.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			if (String(input).includes("/token_plan/remains")) {
				return new Response(JSON.stringify({ base_resp: { status_code: 1004, status_msg: "no plan" } }), { status: 200 });
			}
			return new Response(JSON.stringify({ base_resp: { status_code: 0 }, available_amount: "12.50", currency: "CNY" }), {
				status: 200,
			});
		});

		const result = await fetchMiniMaxQuota("payg-key", "https://api.minimax.cn/v1");

		expect(result.accountKind).toBe("pay_as_you_go");
		expect(result.balances).toEqual([{ label: "MiniMax pay-as-you-go balance", remaining: 12.5, unit: "CNY" }]);
	});

	it("rejects a Key that neither endpoint accepts without leaking the key", async () => {
		jest.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			if (String(input).includes("/v1/models")) {
				return new Response(JSON.stringify({ error: { message: "login fail" } }), { status: 401 });
			}
			return new Response(JSON.stringify({ base_resp: { status_code: 1004, status_msg: "login fail" } }), {
				status: 200,
			});
		});

		const promise = fetchMiniMaxQuota("sk-secret-value", undefined);
		await expect(promise).rejects.toThrow(/login fail/);
		await expect(promise).rejects.not.toThrow(/sk-secret-value/);
	});

	it("normalizes DeepSeek base URLs that include a protocol path", () => {
		expect(normalizeDeepSeekApiBase("https://api.deepseek.com/v1")).toBe("https://api.deepseek.com");
		expect(normalizeDeepSeekApiBase("https://api.deepseek.com/anthropic")).toBe("https://api.deepseek.com");
		expect(normalizeDeepSeekApiBase(undefined)).toBe("https://api.deepseek.com");
	});

	it("keeps every DeepSeek currency wallet instead of summing them", () => {
		const parsed = parseDeepSeekBalance({
			is_available: true,
			balance_infos: [
				{ currency: "CNY", total_balance: "110.00", granted_balance: "10.00", topped_up_balance: "100.00" },
				{ currency: "USD", total_balance: "5.00", granted_balance: "0.00", topped_up_balance: "5.00" },
			],
		});

		expect(parsed.available).toBe(true);
		expect(parsed.balances).toHaveLength(2);
		expect(parsed.balances[0]).toEqual(
			expect.objectContaining({ label: "DeepSeek balance (CNY)", remaining: 110, unit: "CNY" }),
		);
	});


	it("names a pay-as-you-go key even when the undocumented balance endpoint rejects it", async () => {
		jest.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			const url = String(input);
			if (url.includes("/v1/models")) {
				return new Response(JSON.stringify({ data: [] }), { status: 200 });
			}
			return new Response(JSON.stringify({ base_resp: { status_code: 1004, status_msg: "not a plan key" } }), {
				status: 200,
			});
		});

		const result = await fetchMiniMaxQuota("sk-payg", "https://api.minimax.cn/v1");

		expect(result.accountKind).toBe("pay_as_you_go");
		expect(result.balances).toEqual([]);
		expect(result.warning).toContain("pay-as-you-go key");
	});

	it("does not call MiniMax again while the cached account is fresh", async () => {
		const fetchSpy = jest.spyOn(globalThis, "fetch").mockImplementation(async () =>
			new Response(
				JSON.stringify({
					base_resp: { status_code: 0 },
					model_remains: [{ model_name: "general", current_interval_remaining_percent: 80 }],
				}),
				{ status: 200 },
			),
		);
		const service = new ProviderQuotaService();
		const deployments = [deployment("MiniMax-M3", { api_key: "sk-cache" })];

		await service.list(undefined, deployments);
		const callsAfterFirst = fetchSpy.mock.calls.length;
		await service.list(undefined, deployments);

		expect(fetchSpy.mock.calls.length).toBe(callsAfterFirst);
	});

	it("groups models that share one credential into a single account", () => {
		const credentials = {
			getValues: (name: string) =>
				name === "minimax-main" ? { api_key: "sk-minimax-key", api_base: "https://api.minimax.cn/v1" } : undefined,
		};
		const targets = buildQuotaTargets(
			[
				deployment("MiniMax-M3", { litellm_credential_name: "minimax-main" }),
				deployment("MiniMax-M2.7", { litellm_credential_name: "minimax-main" }),
				deployment("gpt-4", { model: "openai/gpt-4", api_key: "sk-openai" }),
			],
			credentials,
		);

		expect(targets).toHaveLength(1);
		expect(targets[0]?.models).toEqual(["MiniMax-M2.7", "MiniMax-M3"]);
		expect(targets[0]?.label).toBe("minimax-main");
	});

	it("never puts the plaintext key into the account id or label", () => {
		const targets = buildQuotaTargets(
			[deployment("MiniMax-M3", { api_key: "sk-inline-secret-value" })],
			undefined,
		);

		expect(targets[0]?.id).not.toContain("sk-inline-secret-value");
		expect(targets[0]?.label).not.toContain("sk-inline-secret-value");
		expect(targets[0]?.label).toBe("••••alue");
	});

	it("resolves provider from custom_llm_provider before the model prefix", () => {
		const deploymentWithOverride: Deployment = {
			model_name: "MiniMax-M3",
			litellm_params: { model: "minimax/MiniMax-M3", custom_llm_provider: "deepseek" },
		};
		expect(resolveProvider(deploymentWithOverride)).toBe("deepseek");
	});
});
