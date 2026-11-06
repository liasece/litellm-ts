import { useQuery } from "@tanstack/react-query";
import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import { uiSpendLogDetailsCall } from "@/components/networking";

/** 详情接口的兜底轮询间隔：只在进行中或落库竞态时启用。 */
export const LOG_DETAILS_POLL_INTERVAL_MS = 2000;

/** 详情负载里轮询关心的最小形状：进行中负载带 status，落库负载没有这个字段。 */
export interface LogDetailsPayloadShape {
	readonly status?: string;
	readonly [field: string]: unknown;
}

/**
 * 是否还要继续兜底轮询详情。
 *
 * 详情端点能自证状态：进行中的负载带 `status: "in_progress"`，落库后的负载没有这个字段。
 * 订阅断开早于 `final` 帧（列表先一步看到请求结束就把连接断掉）时，缓存里会一直留着
 * 最后一份进行中负载；只看列表行会以为"已经结束、无需轮询"，详情就一直停在旧内容上，
 * 必须手动刷新。这里改成以缓存负载为准：只要手上还是进行中的内容，就继续拉取；
 * 另外，进行中却连详情都还没有（订阅建立前就结束、刚清理完在途行）时也继续拉。
 * @param data - 详情查询缓存里的负载
 * @param streamActive - 日志详情流是否已连上（推送期间不轮询）
 * @param listRowInProgress - 列表行是否仍标为进行中
 * @returns 是否继续轮询
 */
export const shouldPollLogDetails = (
	data: LogDetailsPayloadShape | null | undefined,
	streamActive: boolean,
	listRowInProgress: boolean,
): boolean => {
	if (streamActive) return false;
	if (data?.status === "in_progress") return true;
	return listRowInProgress && (data === null || data === undefined);
};

/**
 * Hook to lazy-load log details (messages/response) for a specific log entry.
 * Fetches data on-demand when the drawer is open, instead of prefetching all logs.
 *
 * @param requestId - The request_id of the log entry
 * @param startTime - The formatted start time for the query
 * @param enabled - Whether the query should be enabled (e.g., drawer is open)
 * @param isInProgress - 是否为进行中请求；进行中时按 2 秒轮询，响应不再 in_progress 后自动停止
 * @param streamActive - 日志详情流已连上时不轮询（见 useLogDetailStream），流断开后自动恢复
 */
export const useLogDetails = (
	requestId: string | undefined,
	startTime: string | undefined,
	enabled: boolean,
	isInProgress = false,
	streamActive = false,
) => {
	const { accessToken } = useAuthorized();

	return useQuery({
		queryKey: ["logDetails", requestId, startTime, accessToken],
		queryFn: async () => {
			if (!accessToken || !requestId || !startTime) return null;
			return await uiSpendLogDetailsCall(accessToken, requestId, startTime);
		},
		enabled: enabled && !!accessToken && !!requestId && !!startTime,
		staleTime: 10 * 60 * 1000, // 10 minutes
		gcTime: 10 * 60 * 1000, // 10 minutes
		refetchInterval: (query) =>
			shouldPollLogDetails(query.state.data as LogDetailsPayloadShape | null | undefined, streamActive, isInProgress)
				? LOG_DETAILS_POLL_INTERVAL_MS
				: false,
	});
};
