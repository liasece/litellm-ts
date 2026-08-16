import { useQuery } from "@tanstack/react-query";
import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import { uiSpendLogDetailsCall } from "@/components/networking";

/**
 * Hook to lazy-load log details (messages/response) for a specific log entry.
 * Fetches data on-demand when the drawer is open, instead of prefetching all logs.
 *
 * @param requestId - The request_id of the log entry
 * @param startTime - The formatted start time for the query
 * @param enabled - Whether the query should be enabled (e.g., drawer is open)
 * @param isInProgress - 是否为进行中请求；进行中时按 2 秒轮询，响应不再 in_progress 后自动停止
 */
export const useLogDetails = (
	requestId: string | undefined,
	startTime: string | undefined,
	enabled: boolean,
	isInProgress = false,
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
		refetchInterval: (query) => {
			if (!isInProgress) return false;
			const data = query.state.data as { status?: string } | null | undefined;
			return data?.status === "in_progress" ? 2000 : false;
		},
	});
};
