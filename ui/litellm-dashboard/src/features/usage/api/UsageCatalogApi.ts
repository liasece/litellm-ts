import { z } from "zod";
import { withUsageReadFeedback } from "./UsageReadFeedback";
import { requestJson } from "../../platform/api/HttpApiClient";
import { accessApi } from "../../access-control/api/AccessApi";
export const usageCatalogApi = {
	users: (page: number, search: string, signal?: AbortSignal) =>
		withUsageReadFeedback(() => accessApi.users({ page, page_size: 50, user_email: search || undefined }, signal), signal),
	currentUser: (signal?: AbortSignal) =>
		withUsageReadFeedback(
			() => requestJson("/v2/user/info", { signal }, (v) => z.object({ max_budget: z.number().nullish() }).passthrough().parse(v)),
			signal,
		),
};
