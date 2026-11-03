import { useQuery } from "@tanstack/react-query";
import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import { createQueryKeys } from "@/app/(dashboard)/hooks/common/queryKeysFactory";
import { modelSpeedCall } from "@/components/networking";
import type { ModelSpeedReport } from "../types";

const modelSpeedKeys = createQueryKeys("modelSpeed");

export interface ModelSpeedQuery {
	/** 起始自然日，YYYY-MM-DD */
	readonly startDate: string;
	/** 结束自然日，YYYY-MM-DD（含当天） */
	readonly endDate: string;
	/** 浏览器时区，决定「每天」从几点切分 */
	readonly timezone: string;
}

/**
 * 读取指定区间的「模型输出 TPS」时间序列。
 * @param query 区间与时区
 */
export const useModelSpeed = (query: ModelSpeedQuery) => {
	const { accessToken } = useAuthorized();
	return useQuery<ModelSpeedReport>({
		queryKey: modelSpeedKeys.list({
			filters: { startDate: query.startDate, endDate: query.endDate, timezone: query.timezone },
		}),
		queryFn: async () => await modelSpeedCall(accessToken ?? "", query),
		enabled: Boolean(accessToken && query.startDate && query.endDate),
		staleTime: 60_000,
	});
};

export default useModelSpeed;
