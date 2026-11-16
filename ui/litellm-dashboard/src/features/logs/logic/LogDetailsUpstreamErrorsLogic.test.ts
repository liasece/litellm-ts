import { describe, expect, test } from "vitest";
import type { LogEntry } from "../support/LogsModels";
import { upstreamErrorViews } from "./LogDetailsUpstreamErrorsLogic";

function logWith(overrides: Partial<LogEntry>): LogEntry {
	return { request_id: "req-1", startTime: "2026-11-16T13:55:05.000Z", ...overrides };
}

describe("upstreamErrorViews", () => {
	test("按后端记录顺序列出全部上游错误，并带上地址与状态码", () => {
		const log = logWith({
			metadata: {
				status: "failure",
				error_information: { error_message: "No deployments available for selected model" },
				upstream_errors: [
					{ url: "litellm-subscription://opencode-go/responses", status_code: 429, type: "server_error", message: "overloaded" },
					{ url: "https://backup.example/v1/responses", status_code: 500, type: "server_error", message: "bad gateway" },
				],
			},
		});

		expect(upstreamErrorViews(log)).toEqual([
			{
				label: "Upstream 1",
				type: "server_error",
				code: "429",
				message: "overloaded",
				url: "litellm-subscription://opencode-go/responses",
			},
			{ label: "Upstream 2", type: "server_error", code: "500", message: "bad gateway", url: "https://backup.example/v1/responses" },
		]);
	});

	test("重复错误与已经显示的最终错误不重复列出", () => {
		const log = logWith({
			metadata: {
				status: "failure",
				error_information: { error_message: "final failure" },
				upstream_errors: [
					{ url: "https://provider.example/a", status_code: 429, type: "rate_limit", message: "quota exceeded" },
					{ url: "https://provider.example/a", status_code: 429, type: "rate_limit", message: "quota exceeded" },
					{ url: "https://provider.example/b", status_code: 429, type: "rate_limit", message: "final failure" },
				],
			},
		});

		expect(upstreamErrorViews(log)).toEqual([
			{ label: "Upstream 1", type: "rate_limit", code: "429", message: "quota exceeded", url: "https://provider.example/a" },
		]);
	});

	test("历史日志退回上游响应原文，不依赖新增字段", () => {
		const log = logWith({
			metadata: { status: "failure", error_information: { error_message: "No deployments available" } },
			proxy_server_request: {
				url: "/responses",
				upstream_response: {
					status_code: 429,
					body: { error: { type: "server_error", message: "The inference service is overloaded. Please try again later." } },
				},
			},
		});

		expect(upstreamErrorViews(log)).toEqual([
			{
				label: "Upstream response",
				type: "server_error",
				code: "429",
				message: "The inference service is overloaded. Please try again later.",
				url: null,
			},
		]);
	});

	test("没有 upstream_errors 的历史日志按 fallback 顺序列出逐跳错误", () => {
		const log = logWith({
			metadata: {
				status: "failure",
				error_information: { error_message: "final failure" },
				routing_trace: [
					{
						fallback_index: 1,
						from_model: "hy4-flash",
						to_model: "qwen3.8-27b",
						to_resolved_model: "anthropic/vllm-qwen3.8-27b",
						resolution_path: ["hy4-flash", "qwen3.8-27b"],
						routing_type: "general_fallback",
						reason: "rate_limit",
						attempted_deployment: "e66fa119-bd69-450c-9e30-ea41e1996aef",
						error_information: { error_type: "RateLimitError", error_code: 429, error_message: "quota exceeded" },
					},
				],
			},
		});

		expect(upstreamErrorViews(log)).toEqual([
			{
				label: "Fallback 1 · e66fa119-bd69-450c-9e30-ea41e1996aef",
				type: "RateLimitError",
				code: "429",
				message: "quota exceeded",
				url: null,
			},
		]);
	});

	test("没有上游错误时返回空列表", () => {
		expect(upstreamErrorViews(logWith({ metadata: { status: "success" } }))).toEqual([]);
		expect(
			upstreamErrorViews(logWith({ metadata: { status: "failure", error_information: { error_message: "client aborted" } } })),
		).toEqual([]);
	});
});
