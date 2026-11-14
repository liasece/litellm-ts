import type { NextFunction, Request, Response } from "express";
import { runWithAppliedFeatures } from "../router/AppliedFeatures";

/**
 * 为每个 HTTP 请求建立独立的能力标记账本。
 *
 * 隐私脱敏、推理档位、alias / override、tag 过滤在请求深处各自记一笔，SpendLog 构建时
 * 读取快照；作用域必须早于任何会改写请求的路由，否则先发生的改写会记到上一个请求的
 * 账本上。与 `upstreamExchangeScope` 并列注册，两者的生命周期与隔离边界一致。
 * @param _req - Express 请求（作用域由调用链隐式携带）
 * @param _res - Express 响应
 * @param next - 下一个中间件
 */
export function appliedFeaturesScope(_req: Request, _res: Response, next: NextFunction): void {
	runWithAppliedFeatures(() => next());
}
