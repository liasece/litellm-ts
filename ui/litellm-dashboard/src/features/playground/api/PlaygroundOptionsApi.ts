import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
import type { PlaygroundModel } from "../support/PlaygroundModels";
import { asRecord } from "../logic/PlaygroundValueLogic";
const row = z.record(z.string(), z.unknown());
const model = z.object({ model_name: z.string(), mode: z.string().optional(), type: z.enum(["model", "alias"]).optional() });
export const playgroundOptionsApi = {
	models: (signal?: AbortSignal): Promise<PlaygroundModel[]> =>
		requestJson("/config/routable_model/options", { signal }, (value) =>
			z
				.array(model)
				.parse(Array.isArray(value) ? value : (asRecord(value)?.data ?? []))
				.map((item) => ({ model_group: item.model_name, mode: item.mode, type: item.type })),
		),
	settings: (signal?: AbortSignal) => requestJson("/sso/get/ui_settings", { signal }, (value) => row.parse(value)),
};
