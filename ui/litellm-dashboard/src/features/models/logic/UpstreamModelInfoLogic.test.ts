/**
 * 上游信息前端缓存的测试。
 *
 * 真实行为只有三条：同一模型只请求一次（并发也只一次）、失败按空结果缓存不再重试、
 * 展示值在缺失时回退为占位而不是 0 或 NaN。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatCostPerMillion, formatTokenCount, formatUpstreamField, upstreamFieldRows } from "../support/UpstreamModelInfoModels";

const requestJson = vi.fn();
vi.mock("../../platform/api/HttpApiClient", () => ({ requestJson: (path: string) => requestJson(path) }));

const { ensureUpstreamModelInfo, peekUpstreamModelInfo, pickUpstreamModelInfo, resetUpstreamModelInfoCache } = await import(
	"./UpstreamModelInfoLogic"
);

const payload = {
	source: "opencode-go",
	upstream_model: "glm-5.3",
	status: "ok" as const,
	stale: false,
	fetched_at: "2026-11-18T00:00:00Z",
	expires_at: "2026-11-18T04:00:00Z",
	model_info: { max_input_tokens: 1_000_000, max_output_tokens: 131_072, input_cost_per_token: 1.4e-6 },
	raw: null,
	filled_fields: ["max_output_tokens"],
};

beforeEach(() => {
	resetUpstreamModelInfoCache();
	requestJson.mockReset();
});

describe("ensureUpstreamModelInfo", () => {
	it("并发调用只发一次请求，之后命中缓存", async () => {
		requestJson.mockResolvedValue({
			data: [{ model_name: "glm", model_id: "glm-5.3", provider: "opencode-go", upstream_model_info: payload }],
		});
		const [first, second] = await Promise.all([ensureUpstreamModelInfo("glm"), ensureUpstreamModelInfo("glm")]);
		expect(requestJson).toHaveBeenCalledTimes(1);
		expect(first).toHaveLength(1);
		expect(second).toEqual(first);
		await ensureUpstreamModelInfo("glm");
		expect(requestJson).toHaveBeenCalledTimes(1);
	});

	it("请求失败按空结果缓存，不反复打扰后端", async () => {
		requestJson.mockRejectedValue(new Error("offline"));
		expect(await ensureUpstreamModelInfo("glm")).toEqual([]);
		expect(await ensureUpstreamModelInfo("glm")).toEqual([]);
		expect(requestJson).toHaveBeenCalledTimes(1);
		expect(peekUpstreamModelInfo("glm")).toEqual([]);
	});

	it("过滤没有上游信息的部署条目", async () => {
		requestJson.mockResolvedValue({
			data: [
				{ model_name: "glm", model_id: "a", provider: "opencode-go", upstream_model_info: null },
				{ model_name: "glm", model_id: "b", provider: "opencode-go", upstream_model_info: payload },
			],
		});
		expect(await ensureUpstreamModelInfo("glm")).toHaveLength(1);
	});
});

describe("pickUpstreamModelInfo", () => {
	it("优先匹配指定上游模型，其次 ok 状态", () => {
		const failed = { ...payload, upstream_model: "other", status: "error" as const, model_info: null };
		expect(pickUpstreamModelInfo([failed, payload], "glm-5.3")).toBe(payload);
		expect(pickUpstreamModelInfo([failed, payload])).toBe(payload);
		expect(pickUpstreamModelInfo([])).toBeUndefined();
	});
});

describe("展示格式化", () => {
	it("token 数按 M/K 缩写，缺失显示占位", () => {
		expect(formatTokenCount(1_000_000)).toBe("1M");
		expect(formatTokenCount(131_072)).toBe("131.1K");
		expect(formatTokenCount(null)).toBe("—");
	});

	it("per-token 价格换算成每百万美元", () => {
		expect(formatCostPerMillion(1.4e-6)).toBe("$1.40");
		expect(formatCostPerMillion(undefined)).toBe("—");
		expect(formatUpstreamField("input_cost_per_token", 4.4e-6)).toBe("$4.40");
		expect(formatUpstreamField("supports_vision", true)).toBe("支持");
	});

	it("只输出有值的字段，并保留中文标签", () => {
		const rows = upstreamFieldRows(payload);
		expect(rows.map((row) => row.label)).toEqual(["上下文窗口", "最大输出", "输入单价"]);
	});
});
