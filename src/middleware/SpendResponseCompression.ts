import compression from "compression";
import { constants as zlibConstants } from "node:zlib";

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
});
