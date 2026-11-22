/**
 * 在推理响应开始时暴露本次请求的 SpendLogs request_id。
 *
 * 公司调用方要按 request_id 对账，但 SpendLogs 的主键在客户端发来 `x-request-id` /
 * `idempotency-key` 时是“鉴权命名空间 + 原值”的 SHA-256，否则是随机 UUID；两者都
 * 不能让调用方自己算出来。这里把与记账共用的 ID 直接写进响应头，流式请求也能在
 * 首字节前拿到它，之后用 `GET /spend/cost/request?request_id=...` 回查。
 *
 * 只写自定义头，不覆盖上游透传的 `x-request-id`；头里是哈希或 UUID，不包含密钥。
 */

import type { RequestHandler } from "express";
import { getOrCreateSpendRequestId } from "./SpendTracker";

/** 响应头名；与上游 LiteLLM 的 request id 头区分，避免和 provider 透传冲突。 */
export const SPEND_REQUEST_ID_HEADER = "x-litellm-request-id";

/**
 * 认证之后、端点处理之前挂载：生成或复用本次请求的记账 ID 并写入响应头。
 * @param req - Express 请求
 * @param res - Express 响应
 * @param next - 继续中间件链
 */
export const spendRequestIdHeaderMiddleware: RequestHandler = (req, res, next) => {
	if (req.auth) {
		res.setHeader(SPEND_REQUEST_ID_HEADER, getOrCreateSpendRequestId(req));
	}
	next();
};
