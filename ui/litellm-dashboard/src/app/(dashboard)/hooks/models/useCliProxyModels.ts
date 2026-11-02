import { getCliProxyModels } from "@/components/networking";
import { useQuery } from "@tanstack/react-query";
import { createQueryKeys } from "../common/queryKeysFactory";

const cliProxyModelsKeys = createQueryKeys("cliProxyModels");

/**
 * 列出托管 CLIProxyAPI 当前可用的模型 ID。
 * @param enabled 仅在需要该列表时发起请求（例如编辑页选中 CLIProxy provider）。
 */
export const useCliProxyModels = (enabled: boolean = true) => {
	return useQuery<string[]>({
		queryKey: cliProxyModelsKeys.list({}),
		queryFn: async () => await getCliProxyModels(),
		enabled,
		staleTime: 60 * 1000,
	});
};
