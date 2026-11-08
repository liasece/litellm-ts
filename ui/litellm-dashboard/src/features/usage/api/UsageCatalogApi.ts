import { z } from "zod";
import { withUsageReadFeedback } from "./UsageReadFeedback";
import { requestJson } from "../../platform/api/HttpApiClient";
import { accessApi } from "../../access-control/api/AccessApi";
const customer = z.object({ user_id: z.string(), alias: z.string().nullish() }).passthrough();
const agent = z.object({ agent_id: z.string(), agent_name: z.string() }).passthrough();
const tag = z.object({ name: z.string() }).passthrough();
export const usageCatalogApi = {
	users: (page: number, search: string, signal?: AbortSignal) =>
		withUsageReadFeedback(() => accessApi.users({ page, page_size: 50, user_email: search || undefined }, signal), signal),
	customers: (signal?: AbortSignal) =>
		withUsageReadFeedback(() => requestJson("/customer/list", { signal }, (v) => z.array(customer).parse(v)), signal),
	agents: (signal?: AbortSignal) =>
		withUsageReadFeedback(() => requestJson("/v1/agents", { signal }, (v) => z.array(agent).parse(v)), signal),
	tags: (signal?: AbortSignal) =>
		withUsageReadFeedback(
			() => requestJson("/tag/list", { signal }, (v) => Object.values(z.union([z.array(tag), z.record(z.string(), tag)]).parse(v))),
			signal,
		),
	currentUser: (signal?: AbortSignal) =>
		withUsageReadFeedback(
			() => requestJson("/v2/user/info", { signal }, (v) => z.object({ max_budget: z.number().nullish() }).passthrough().parse(v)),
			signal,
		),
};
