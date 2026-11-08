import { z } from "zod";
import { requestJson } from "../../../platform/api/HttpApiClient";
const record = z.record(z.string(), z.unknown()),
	records = z.array(record);
export type LegacyRow = Record<string, unknown>;
const list = (path: string) => requestJson(path, {}, (value) => records.parse(value));
function monthQuery(from: string, to: string) {
	return "?start_date=" + from + "&end_date=" + to;
}
export const legacyUsageApi = {
	settings: () => requestJson("/sso/get/ui_settings", {}, (value) => record.parse(value)),
	spend: () => list("/global/spend/logs"),
	topKeys: () => list("/global/spend/keys"),
	topModels: () => list("/global/spend/models?limit=5"),
	teams: () => requestJson("/global/spend/teams", {}, (value) => record.parse(value)),
	tagNames: () =>
		requestJson("/global/spend/all_tag_names", {}, (value) => z.object({ tag_names: z.array(z.string()) }).parse(value).tag_names),
	tags: (from?: Date, to?: Date, tags?: string[]) =>
		requestJson(
			"/global/spend/tags" +
				(from && to ? monthQuery(from.toISOString(), to.toISOString()) : "") +
				(tags ? "&tags=" + tags.join(",") : ""),
			{},
			(value) => z.object({ spend_per_tag: records }).parse(value).spend_per_tag,
		),
	endUsers: (key: string | null, from?: Date, to?: Date) =>
		requestJson(
			"/global/spend/end_users",
			{
				method: "POST",
				body: JSON.stringify({ ...(key ? { api_key: key } : {}), startTime: from?.toISOString(), endTime: to?.toISOString() }),
			},
			(value) => records.parse(value),
		),
	providers: (from: string, to: string) => list("/global/spend/provider" + monthQuery(from, to) + "&api_key=cookie-session"),
	activity: (from: string, to: string) => requestJson("/global/activity" + monthQuery(from, to), {}, (value) => record.parse(value)),
	modelActivity: (from: string, to: string) => list("/global/activity/model" + monthQuery(from, to)),
};
