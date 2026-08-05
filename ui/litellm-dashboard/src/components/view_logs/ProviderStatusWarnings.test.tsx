import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { LogEntry } from "./columns";
import ProviderStatusWarnings, { collectProviderStatusWarnings } from "./ProviderStatusWarnings";

const NOW = new Date("2026-08-04T08:00:00.000Z");

function createLog(overrides: Partial<LogEntry>): LogEntry {
	return {
		request_id: "request-1",
		api_key: "api-key",
		team_id: "team-id",
		model: "model",
		model_id: "model-id",
		call_type: "chat",
		spend: 0,
		total_tokens: 0,
		prompt_tokens: 0,
		completion_tokens: 0,
		startTime: "2026-08-04T07:59:00.000Z",
		endTime: "2026-08-04T07:59:01.000Z",
		cache_hit: "miss",
		messages: [],
		response: {},
		status: "failure",
		metadata: {
			status: "failure",
			error_information: { error_code: 500 },
		},
		...overrides,
	};
}

describe("ProviderStatusWarnings", () => {
	it("shows simultaneous warnings grouped by provider and links DeepSeek to its status page", () => {
		const logs = [
			createLog({
				request_id: "deepseek-503",
				custom_llm_provider: "deepseek",
				metadata: { status: "failure", error_information: { error_code: "503" } },
			}),
			createLog({
				request_id: "deepseek-500",
				custom_llm_provider: "deepseek",
				startTime: "2026-08-04T07:58:00.000Z",
			}),
			createLog({
				request_id: "anthropic-502",
				custom_llm_provider: "anthropic",
				startTime: "2026-08-04T07:57:00.000Z",
				metadata: { status: "failure", error_information: { error_code: 502 } },
			}),
		];

		const warnings = collectProviderStatusWarnings(logs, NOW);
		expect(warnings).toMatchObject([
			{ provider: "deepseek", errorCount: 2, errorCodes: [500, 503] },
			{ provider: "anthropic", errorCount: 1, errorCodes: [502] },
		]);

		render(<ProviderStatusWarnings logs={logs} now={NOW} />);

		expect(screen.getByText("DeepSeek may be experiencing a service issue")).toBeInTheDocument();
		expect(screen.getByText("Anthropic may be experiencing a service issue")).toBeInTheDocument();
		expect(screen.getByText(/2 recent requests returned server errors \(500, 503\)/)).toBeInTheDocument();
		expect(screen.getByRole("link", { name: "View DeepSeek status" })).toHaveAttribute(
			"href",
			"https://status.deepseek.com/",
		);
	});

	it("ignores non-5xx, successful, stale, future-skewed, and providerless rows", () => {
		const warnings = collectProviderStatusWarnings(
			[
				createLog({
					request_id: "rate-limit",
					custom_llm_provider: "openai",
					metadata: { status: "failure", error_information: { error_code: 429 } },
				}),
				createLog({
					request_id: "success-with-stale-error",
					custom_llm_provider: "openai",
					status: "success",
					metadata: { status: "success", error_information: { error_code: 500 } },
				}),
				createLog({
					request_id: "stale",
					custom_llm_provider: "deepseek",
					startTime: "2026-08-04T07:44:59.000Z",
				}),
				createLog({
					request_id: "future",
					custom_llm_provider: "anthropic",
					startTime: "2026-08-04T08:05:01.000Z",
				}),
				createLog({ request_id: "providerless" }),
			],
			NOW,
		);

		expect(warnings).toEqual([]);
	});

	it("derives the provider from a prefixed model when the provider field is absent", () => {
		const warnings = collectProviderStatusWarnings(
			[createLog({ custom_llm_provider: undefined, model: "deepseek/deepseek-chat" })],
			NOW,
		);

		expect(warnings).toMatchObject([
			{
				provider: "deepseek",
				displayName: "DeepSeek",
				errorCount: 1,
			},
		]);
	});

	it("recognizes a provider model alias when the failed request has no provider metadata", () => {
		const warnings = collectProviderStatusWarnings(
			[createLog({ custom_llm_provider: undefined, model: "deepseek-v4-flash" })],
			NOW,
		);

		expect(warnings).toMatchObject([
			{
				provider: "deepseek",
				displayName: "DeepSeek",
				errorCount: 1,
				errorCodes: [500],
			},
		]);
	});

	it("attributes a failed fallback to the final provider model when the row keeps the original model group", () => {
		const warnings = collectProviderStatusWarnings(
			[
				createLog({
					custom_llm_provider: undefined,
					model: "qwen3.6-27b",
					metadata: {
						status: "failure",
						error_information: { error_code: 529 },
						fallback_models: ["qwen3.6-27b", "MiniMax-M2.7"],
					},
				}),
			],
			NOW,
		);

		expect(warnings).toMatchObject([
			{
				provider: "minimax",
				displayName: "MiniMax",
				errorCount: 1,
				errorCodes: [529],
			},
		]);
	});
});
