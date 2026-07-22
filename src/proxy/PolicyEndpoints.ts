/**
 * Policy 端点
 *
 * GET /policy/list：返回当前加载的 policy 摘要，
 * 对齐 Python litellm/proxy/management_endpoints/policy_endpoints/endpoints.py list_policies。
 * TS 端无 policy engine，空实现对齐 Python 无配置时的响应。
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";
import { ApiError } from "../core/api/ApiError";

/**
 * @param router
 */
export function registerPolicyRoutes(router: Router): void {
	registerRoute(router, { method: "post", path: "/policy/new" }, notImpl("Policy 创建"));
	registerRoute(router, { method: "post", path: "/policy/update" }, notImpl("Policy 更新"));
	// PY list_policies：get_policies_summary() 空配置时返回 {policies:{}, total_count:0}
	registerRoute(router, { method: "get", path: "/policy/list" }, () => ({ policies: {}, total_count: 0 }));
}

function notImpl(name: string) {
	return () => {
		throw new ApiError(503, `${name} 暂未实现`);
	};
}
