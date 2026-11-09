import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";

const identity = z.object({ family: z.string().nullable(), provider: z.string().nullable() });
const catalog = z.object({ data: z.array(z.object({ model_group: z.string(), model_identity: identity.optional() })) });
export type ModelGroupIcons = Map<string, z.infer<typeof identity> | undefined>;

export async function fetchModelGroupIcons(signal?: AbortSignal): Promise<ModelGroupIcons> {
	const result = await requestJson("/model_group/info?include_model_identity=true", { signal }, (value) => catalog.parse(value));
	return new Map(result.data.filter((row) => row.model_group).map((row) => [row.model_group, row.model_identity]));
}
