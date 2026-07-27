import { modelCostMap } from "@/components/networking";
import { useQuery } from "@tanstack/react-query";
import { createQueryKeys } from "../common/queryKeysFactory";

const modelCostMapKeys = createQueryKeys("modelCostMap");

export const useModelCostMap = (enabled: boolean = true, refreshWhenEnabled: boolean = false) => {
	return useQuery<Record<string, any>>({
		queryKey: modelCostMapKeys.list({}),
		queryFn: async () => await modelCostMap(),
		enabled,
		staleTime: refreshWhenEnabled ? 0 : 60 * 1000, // Active tabs should always re-check cached price data.
		gcTime: 60 * 1000, // 1 minute
	});
};
