import { builtinCatalogForSource } from "./dynamicCatalog";
import { catalogForSource, refreshDynamicCatalog } from "./catalog";

/** 用固定响应构造 fetch。 */
function mockFetch(body: unknown): { calls: number; fetchImpl: typeof fetch } {
	const state = { calls: 0 };
	const fetchImpl = (async (): Promise<Response> => {
		state.calls += 1;
		return {
			ok: true,
			status: 200,
			text: async (): Promise<string> => JSON.stringify(body),
		} as unknown as Response;
	}) as unknown as typeof fetch;
	return {
		/** 已被调用的次数。 */
		get calls(): number {
			return state.calls;
		},
		fetchImpl: fetchImpl,
	};
}

describe("订阅模型目录入口", () => {
	it("动态来源尚未拉取时回落到内置目录", () => {
		expect(catalogForSource("commandcode")).toBe(builtinCatalogForSource("commandcode"));
		expect(catalogForSource("opencode-go")).toBe(builtinCatalogForSource("opencode-go"));
	});

	it("静态来源刷新不依赖网络", async () => {
		const network = mockFetch({ data: [] });
		const models = await refreshDynamicCatalog("claude", "", network.fetchImpl);
		expect(models.length).toBeGreaterThan(0);
		expect(network.calls).toBe(0);
	});

	it("动态来源刷新走上游目录", async () => {
		const network = mockFetch({ data: [{ id: "deepseek/deepseek-v4.1-flash", display_name: "DeepSeek V4.1 Flash" }] });
		await expect(refreshDynamicCatalog("commandcode", "cc-key", network.fetchImpl)).resolves.toEqual([
			expect.objectContaining({ id: "deepseek/deepseek-v4.1-flash", protocol: "responses" }),
		]);
		expect(network.calls).toBe(1);
	});
});
