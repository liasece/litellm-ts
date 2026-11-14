/**
 * 能力标记账本的行为：作用域隔离、按 id 归并、fallback 派生，以及 alias / override 边的
 * 记账口径。这些断言对应日志 Feature 列的真实取值，不重复实现细节。
 */
import { FallbackHandler } from "./FallbackHandler";
import {
	deriveFallbackAppliedFeatures,
	mergeAppliedFeatures,
	noteAppliedFeature,
	noteResolutionAppliedFeatures,
	runWithAppliedFeatures,
	snapshotAppliedFeatures,
} from "./AppliedFeatures";
import { createModelResolutionTraceCollector, type RoutingTraceEntry } from "./ModelResolutionTrace";
import { Router } from "./Router";
import { RoutingStrategyName } from "../types/router";
import { installMockFetch, okResponse } from "./RouterTestHelpers";

function traceEntry(overrides: Partial<RoutingTraceEntry>): RoutingTraceEntry {
	return {
		fallback_index: 1,
		from_model: "primary",
		to_model: "backup",
		to_resolved_model: "backup",
		resolution_path: ["backup"],
		routing_type: "general_fallback",
		reason: "rate_limit",
		error_information: { error_type: "Error", error_code: 429, error_message: "rate limited" },
		...overrides,
	};
}

describe("能力标记账本", () => {
	it("没有作用域时静默忽略，不产生任何记录", () => {
		noteAppliedFeature({ id: "tag_routing", detail: "default" });
		expect(snapshotAppliedFeatures()).toBeUndefined();
	});

	it("同一 id 只保留一条，重复出现不改变首次的 detail", () => {
		runWithAppliedFeatures(() => {
			noteAppliedFeature({ id: "alias", detail: "a → b" });
			noteAppliedFeature({ id: "alias", detail: "c → d" });
			expect(snapshotAppliedFeatures()).toEqual([{ id: "alias", detail: "a → b" }]);
		});
	});

	it("次数增长时用最新统计覆盖，次数为 1 时不写 count", () => {
		runWithAppliedFeatures(() => {
			noteAppliedFeature({ id: "privacy", detail: "EMAIL×1" });
			noteAppliedFeature({ id: "privacy", count: 4, detail: "EMAIL×4" });
			expect(snapshotAppliedFeatures()).toEqual([{ id: "privacy", detail: "EMAIL×4", count: 4 }]);
		});
	});

	it("内层子作用域不污染外层请求账本", () => {
		runWithAppliedFeatures(async () => {
			noteAppliedFeature({ id: "privacy", count: 2 });
			await runWithAppliedFeatures(async () => {
				noteAppliedFeature({ id: "fallback", detail: "worker → backup" });
				expect(snapshotAppliedFeatures()).toEqual([{ id: "fallback", detail: "worker → backup" }]);
			});
			expect(snapshotAppliedFeatures()).toEqual([{ id: "privacy", count: 2 }]);
		});
	});

	it("从 routing_trace 派生 fallback：按类型归并、次数为跳数、detail 为最后一跳", () => {
		const trace = [
			traceEntry({ fallback_index: 1, to_resolved_model: "backup-1", routing_type: "context_window_fallback" }),
			traceEntry({ fallback_index: 2, to_resolved_model: "backup-2", routing_type: "general_fallback" }),
			traceEntry({ fallback_index: 3, to_resolved_model: "backup-3", routing_type: "context_window_fallback" }),
		];
		expect(deriveFallbackAppliedFeatures(trace)).toEqual([
			{ id: "fallback:context_window", detail: "primary → backup-3", count: 2 },
			{ id: "fallback", detail: "primary → backup-2", count: 1 },
		]);
	});

	it("合并时现场记录在前、派生 fallback 在后，且不重复同 id", () => {
		const merged = mergeAppliedFeatures(
			[
				{ id: "override", detail: "gpt-4o → claude" },
				{ id: "fallback", detail: "旧的落账记录" },
			],
			[traceEntry({ to_resolved_model: "backup-2" })],
		);
		expect(merged).toEqual([
			{ id: "override", detail: "gpt-4o → claude" },
			{ id: "fallback", detail: "旧的落账记录" },
		]);
	});

	it("既没有现场记录也没有 fallback 时返回 undefined", () => {
		expect(mergeAppliedFeatures(undefined, [])).toBeUndefined();
	});
});

describe("alias / override 边的能力标记", () => {
	it("普通 alias 记 alias，模型级 override 记 override，时段 alias 记 alias:scheduled", () => {
		const at = new Date("2026-11-14T02:00:00.000Z");
		const handler = new FallbackHandler(
			undefined,
			{ legacy: "real-model", "peak-name": { model: "cheap-model", hidden: false, timezone: "UTC", schedule: [{ start: "01:00", end: "03:00", model: "expensive-model" }] } },
			undefined,
			undefined,
			{ "real-model": "redirected-model" },
			at,
		);
		runWithAppliedFeatures(() => {
			noteResolutionAppliedFeatures(handler.resolveModelGroupWithTrace("legacy"));
			expect(snapshotAppliedFeatures()).toEqual([
				{ id: "alias", detail: "legacy → real-model" },
				{ id: "override", detail: "real-model → redirected-model" },
			]);
		});
		runWithAppliedFeatures(() => {
			noteResolutionAppliedFeatures(handler.resolveModelGroupWithTrace("peak-name"));
			expect(snapshotAppliedFeatures()).toEqual([{ id: "alias:scheduled", detail: "peak-name → expensive-model" }]);
		});
	});

	it("没有跨过任何边时不记录", () => {
		const handler = new FallbackHandler(undefined, { legacy: "real-model" });
		runWithAppliedFeatures(() => {
			noteResolutionAppliedFeatures(handler.resolveModelGroupWithTrace("real-model"));
			expect(snapshotAppliedFeatures()).toBeUndefined();
		});
	});
});

describe("真实路由调用里的能力标记", () => {
	const mockFetch = installMockFetch();

	function okBody(): Response {
		return okResponse({
			id: "chat-1",
			object: "chat.completion",
			created: 1,
			model: "backup-model",
			choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
			usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
		});
	}

	function makeRouter(): Router {
		return new Router({
			model_list: [
				{
					model_name: "alias-name",
					litellm_params: {
						model: "deepseek/deepseek-v4-flash",
						custom_llm_provider: "deepseek",
						api_key: "key",
						tags: ["default"],
					},
					model_info: { id: "primary" },
				},
				{
					model_name: "backup-model",
					litellm_params: {
						model: "deepseek/deepseek-v4-flash",
						custom_llm_provider: "deepseek",
						api_key: "key",
						tags: ["default"],
					},
					model_info: { id: "backup" },
				},
			],
			routing_strategy: RoutingStrategyName.SimpleShuffle,
			num_retries: 0,
			model_group_alias: { "public-name": "alias-name" },
			fallbacks: [{ "alias-name": ["backup-model"] }],
		});
	}

	it("alias 展开、tag 过滤与 fallback 分别落进账本与派生结果", async () => {
		mockFetch.mockReset();
		mockFetch.mockRejectedValueOnce(new Error("ECONNRESET")).mockResolvedValueOnce(okBody());
		const features = await runWithAppliedFeatures(async () => {
			const trace = createModelResolutionTraceCollector();
			await makeRouter().completion("public-name", [{ role: "user", content: "hi" }], { metadata: { tags: ["default"] } }, trace);
			return mergeAppliedFeatures(snapshotAppliedFeatures(), trace.routingTrace);
		});

		expect(features).toEqual([
			{ id: "alias", detail: "public-name → alias-name" },
			{ id: "tag_routing", detail: "default" },
			{ id: "fallback", detail: "public-name → backup-model", count: 1 },
		]);
	});

	it("没有 alias、没有 tag、没有 fallback 的请求不留任何标记", async () => {
		mockFetch.mockReset();
		mockFetch.mockResolvedValueOnce(okBody());
		const features = await runWithAppliedFeatures(async () => {
			const trace = createModelResolutionTraceCollector();
			await makeRouter().completion("backup-model", [{ role: "user", content: "hi" }], {}, trace);
			return mergeAppliedFeatures(snapshotAppliedFeatures(), trace.routingTrace);
		});
		expect(features).toBeUndefined();
	});
});
