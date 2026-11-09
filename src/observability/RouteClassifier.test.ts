import { classifyRoute } from "./RouteClassifier";

describe("classifyRoute", () => {
	it("丢弃查询串，避免标签随参数爆炸", () => {
		expect(classifyRoute("/v1/models?return_when=current")).toBe("/v1/models");
		expect(classifyRoute("/ui/?page=usage&start=2026-01-01")).toBe("/ui");
	});

	it("把数字段与长 ID 段归一化成 :id", () => {
		expect(classifyRoute("/key/123/info")).toBe("/key/:id/info");
		expect(classifyRoute("/team/1f8f4c2a-9b3d-4f2e-8a11-77c0e5d12345/members")).toBe("/team/:id/members");
		expect(classifyRoute("/model/info/f3a91c88b7d24e6f9012abcd")).toBe("/model/info/:id");
	});

	it("超过三段折叠为 /*，保持基数可控", () => {
		expect(classifyRoute("/a/b/c/d/e")).toBe("/a/b/c/*");
		expect(classifyRoute("/ui/images/logos/provider.svg")).toBe("/ui/images/logos/*");
	});

	it("根路径与末尾斜杠保持稳定", () => {
		expect(classifyRoute("/")).toBe("/");
		expect(classifyRoute("/health/readiness")).toBe("/health/readiness");
		expect(classifyRoute("/v1/chat/completions/")).toBe("/v1/chat/completions");
	});
});
