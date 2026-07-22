/**
 * SpendLogColdStorage — 日志详情冷存储 CustomLogger 钩子注册表
 *
 * 对齐 PY spend_management_endpoints.py:2028-2048 `ui_view_request_response_for_request_id`：
 * 详情端点先遍历注册的 CustomLogger（S3/GCS 等冷存储实现），任一返回非 null payload
 * 即直接采用；全部未命中时回落 DB 重列（messages/response/proxy_server_request）。
 *
 * TS 目前无任何冷存储实现，注册表恒空、控制流就位——未来接入冷存储时只需
 * 实现 SpendLogColdStorageLogger 并调 registerSpendLogColdStorageLogger。
 */

/**
 * 冷存储 CustomLogger 接口（PY CustomLogger.get_request_response_payload 等价物）。
 * 实现方按 request_id（+可选时间窗）回查冷存储中的请求/响应完整 payload。
 */
export interface SpendLogColdStorageLogger {
	/**
	 * 回查冷存储中的请求/响应 payload；未命中返回 null（继续尝试下一 logger / 回落 DB）。
	 * @param requestId - SpendLogs.request_id
	 * @param startTimeUtc - 可选查询时间窗起点（UTC）
	 * @param endTimeUtc - 可选查询时间窗终点（UTC）
	 */
	getRequestResponsePayload(requestId: string, startTimeUtc?: Date, endTimeUtc?: Date): Promise<Record<string, unknown> | null>;
}

const registeredLoggers: SpendLogColdStorageLogger[] = [];

/**
 * 注册冷存储 CustomLogger。服务启动时由冷存储实现方调用。
 * @param coldStorageLogger - 冷存储回查实现
 */
export function registerSpendLogColdStorageLogger(coldStorageLogger: SpendLogColdStorageLogger): void {
	registeredLoggers.push(coldStorageLogger);
}

/**
 * 依次询问所有已注册冷存储 logger，返回首个非 null payload；全部未命中返回 null。
 * 单个 logger 抛错不阻断后续 logger（对齐 PY for 循环逐一直接 await 的容错语义——
 * PY 任一异常会冒泡为 500；TS 选择记日志继续，避免一个冷存储故障拖垮详情查询）。
 * @param requestId - SpendLogs.request_id
 * @param startTimeUtc - 可选查询时间窗起点（UTC）
 * @param endTimeUtc - 可选查询时间窗终点（UTC）
 * @param onError - 单个 logger 失败时的错误回调（由调用方接 logger）
 */
export async function getRequestResponsePayloadFromColdStorage(
	requestId: string,
	startTimeUtc: Date | undefined,
	endTimeUtc: Date | undefined,
	onError: (logger: SpendLogColdStorageLogger, error: unknown) => void,
): Promise<Record<string, unknown> | null> {
	for (const coldStorageLogger of registeredLoggers) {
		try {
			const payload = await coldStorageLogger.getRequestResponsePayload(requestId, startTimeUtc, endTimeUtc);
			if (payload !== null) {
				return payload;
			}
		} catch (error) {
			onError(coldStorageLogger, error);
		}
	}
	return null;
}
