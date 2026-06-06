/**
 * 花费管理端点入口
 *
 * 提供 LiteLLM Proxy 兼容的花费查询 API。
 * 使用 Drizzle ORM 查询 liteLLM_SpendLogs 表。
 * 协议源码：https://github.com/BerriAI/litellm/blob/main/litellm/proxy/proxy_server.py
 * 协议类型：https://github.com/BerriAI/litellm/blob/main/litellm/proxy/_types.py
 *
 * 拆分说明：本文件只保留入口 `registerSpendManagementEndpoints`，实际端点注册按
 * 职责拆分到：
 * - `./spendLogsEndpoints.ts`：/spend/keys、/spend/users、/spend/tags、/spend/logs、
 *   /spend/logs/ui、/spend/logs/ui/:request_id、/spend/calculate
 * - `./globalSpendEndpoints.ts`：/global/activity、/global/spend、/global/spend/keys、
 *   /global/spend/teams、/global/spend/models、/global/spend/providers、/global/spend/report、
 *   /global/spend/logs、/global/spend/provider、/global/activity/model、/global/spend/tags、
 *   /global/spend/all_tag_names、/global/spend/end_users
 *
 * 纯函数 helper（formatter / 归一化 / 月度日期范围）见 `./spendManagementFormatters.ts`。
 * 排序方向、limit 常量与 runWithFallback 见 `./spendManagementHelpers.ts`。
 *
 * 公共入口保持原签名不变，main.ts 与单元测试（`SpendManagementEndpoint.test.ts`）继续
 * 通过 `registerSpendManagementEndpoints` 注册所有路由。
 */

import type { Router, Request, Response } from "express";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "../db/schema";
import { createModuleLogger } from "../core/utils/logger";
import { registerGlobalSpendEndpoints } from "./globalSpendEndpoints";
import { registerSpendLogsEndpoints } from "./spendLogsEndpoints";

const logger = createModuleLogger("SpendMgmt");

/**
 * 注册所有花费管理端点
 * @param router - Express Router 实例
 * @param db - Drizzle 数据库实例
 * @param _requireAuth - 可选的认证中间件（保留参数签名以兼容外部调用）
 */
export function registerSpendManagementEndpoints(
	router: Router,
	db: NodePgDatabase<typeof schema>,
	_requireAuth?: (req: Request, res: Response, next: () => void) => void,
): void {
	logger.info("Registering spend management endpoints");
	registerSpendLogsEndpoints(router, db);
	registerGlobalSpendEndpoints(router, db);
}
