import { useEffect, useRef } from "react";

/**
 * 请求刚结束时补拉一次详情。
 *
 * 列表（Live Tail 的 `logs_changed`）常常比详情流的 `final` 帧先一步看到请求结束：列表行一
 * 变成已结束状态，抽屉就断掉订阅，服务端随后要发的最终负载就收不到了，详情缓存只剩最后
 * 一份进行中内容。这里在"进行中 → 已结束"的瞬间主动拉一次，把落库后的完整数据补上。
 *
 * 只在从进行中变为结束时触发：首次打开一条早就结束的日志不会额外请求。
 * @param isInProgress - 列表行是否仍标为进行中
 * @param refetch - 详情查询的重新拉取函数
 */
export function useRefreshOnSettle(isInProgress: boolean, refetch: () => unknown): void {
	const wasInProgress = useRef(isInProgress);

	useEffect(() => {
		const settledNow = wasInProgress.current && !isInProgress;
		wasInProgress.current = isInProgress;
		if (settledNow) {
			void refetch();
		}
	}, [isInProgress, refetch]);
}
