/**
 * RouterTestHelpers — Router 单元测试共享 helper
 *
 * DIFF-ROUTER-TEST-01: 抽离 Router.test.ts 的公共工具（mkDeployment / okResponse / errorResponse），
 * 让拆分后的多个 Router.*.test.ts 文件能复用。
 */

import type { Deployment } from "../types/router";

/**
 * 全局 mock fetch 句柄（set in beforeEach）。
 */
export interface RouterTestGlobals {
	/**
	 *
	 */
	mockFetch: jest.Mock;
}

/**
 * 创建测试用 deployment
 * @param name
 * @param model
 * @param extras
 */
export function mkDeployment(name: string, model = "gpt-4", extras: Partial<Deployment> = {}): Deployment {
	return {
		model_name: name,
		litellm_params: { model: model, api_key: "test-key" },
		model_info: { id: name },
		...extras,
	};
}

/**
 * 构造 200 JSON 响应
 * @param body
 * @param status
 */
export function okResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), { status: status, headers: { "content-type": "application/json" } });
}

/**
 * 构造错误 JSON 响应
 * @param status
 * @param body
 */
export function errorResponse(status: number, body: Record<string, unknown> = { error: "err" }): Response {
	return new Response(JSON.stringify(body), { status: status, headers: { "content-type": "application/json" } });
}

/**
 * 安装全局 mock fetch（在 beforeEach 调用）。
 * 暴露的 mockFetch 供测试断言 callCount / response 配置。
 */
export function installMockFetch(): jest.Mock {
	const mockFetch = jest.fn() as unknown as jest.Mock;
	global.fetch = mockFetch as unknown as typeof fetch;
	return mockFetch;
}
