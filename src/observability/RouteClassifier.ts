/**
 * 把请求路径归一化成低基数的路由类别。
 *
 * 直接用 `req.originalUrl` 做标签会随查询串、ID、文件名爆炸；只用 `req.route.path`
 * 又覆盖不到 404、静态资源与 WebSocket 之外的旁路请求。这里做通用归一化：
 * 丢弃查询串、把数字/长 ID 段替换成 `:id`、最多保留三段，超出部分折叠成 `/*`。
 */

/** 路由类别最大段数；再深的分层对定位性能没有帮助，只会增加基数。 */
const MAX_SEGMENTS = 3;

/** 段长超过该阈值视为 ID 类标识（UUID、hash、模型部署 ID）。 */
const ID_SEGMENT_LENGTH = 24;

/** 纯数字段。 */
const NUMERIC_SEGMENT = /^\d+$/;

/** 形如 UUID 或 16 进制长串的段。 */
const HASH_SEGMENT = /^(?:[0-9a-f]{8,}|[0-9a-f-]{16,})$/i;

/**
 * 归一化请求路径。
 * @param path - 原始路径（可含查询串）
 */
export function classifyRoute(path: string): string {
	const withoutQuery = path.split("?")[0] ?? path;
	const segments = withoutQuery.split("/").filter((segment) => segment.length > 0);
	if (segments.length === 0) {
		return "/";
	}
	const normalized: string[] = [];
	for (const segment of segments.slice(0, MAX_SEGMENTS)) {
		if (NUMERIC_SEGMENT.test(segment) || (segment.length >= ID_SEGMENT_LENGTH && HASH_SEGMENT.test(segment))) {
			normalized.push(":id");
			continue;
		}
		normalized.push(segment);
	}
	const prefix = `/${normalized.join("/")}`;
	if (segments.length > MAX_SEGMENTS) {
		return `${prefix}/*`;
	}
	return prefix;
}
