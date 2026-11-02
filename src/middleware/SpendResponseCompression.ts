import compression from "compression";
import type { Request, Response } from "express";
import { constants as zlibConstants } from "node:zlib";

/** 消费报表实际注册的两组路由前缀：`/spend/*` 与 `/global/*`。 */
const SPEND_ROUTE_PATH = /^\/(?:spend|global)(?:\/|$)/;

/**
 * 判断响应是否为事件流（SSE）。
 * @param res - 即将写出响应头的响应对象
 */
function isEventStream(res: Response): boolean {
	const contentType = res.getHeader("Content-Type");
	return typeof contentType === "string" && contentType.toLowerCase().startsWith("text/event-stream");
}

/**
 * 是否对该响应启用压缩。
 *
 * 按路径收口：本中间件挂在 router 级，而 `spendRouter` 在 main.ts 里以空前缀全局挂载，
 * 排在它后面的 `stubRouter` 才处理 `/v1/responses` 等推理端点。缺少这层判断时，凡是
 * 穿透到下游路由的请求都会先被包住响应体：模型 SSE 被当成普通实体压缩，而 gzip/brotli
 * 压缩器只在内部缓冲填满或流结束时输出，整段回答就会攒到最后一刻一次性到达客户端。
 * 客户端用“最后一块到达时间减第一块到达时间”计算生成耗时，于是首字时间等于总耗时、
 * tok/s 比真实值高三个数量级。压缩只服务消费报表，不应作用于其他路由。
 *
 * 再排除事件流：即便将来消费侧出现流式端点，事件流的价值在逐块时延而不是带宽，经过
 * 压缩器只会把时延重新攒起来；这条约束与路径无关，用来防止同类问题换条路径重现。
 *
 * 末尾回落到 `compression.filter`，保留其按 Content-Type 判断可压缩性的默认行为。
 * @param req - 当前请求；用 `baseUrl + path` 保证路由挂载前缀变化后仍然正确
 * @param res - 当前响应
 * @returns 该响应是否应当压缩
 */
export function shouldSpendResponseCompress(req: Request, res: Response): boolean {
	if (!SPEND_ROUTE_PATH.test(`${req.baseUrl}${req.path}`)) {
		return false;
	}
	if (isEventStream(res)) {
		return false;
	}
	return compression.filter(req, res);
}

/**
 * Spend/Logs 返回大量高度重复的 JSON（历史 messages 与 proxy request）。
 * 仅在非流式 Spend 路由启用压缩，避免影响模型 SSE；Brotli quality 4
 * 在生产 Session 样本上兼顾了压缩率与 CPU，gzip level 1 用作旧客户端回退。
 */
export const spendResponseCompression = compression({
	threshold: "16kb",
	level: zlibConstants.Z_BEST_SPEED,
	brotli: {
		params: {
			[zlibConstants.BROTLI_PARAM_QUALITY]: 4,
		},
	},
	filter: shouldSpendResponseCompress,
});
