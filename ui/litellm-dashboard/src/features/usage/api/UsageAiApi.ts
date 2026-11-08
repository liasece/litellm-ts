import { z } from "zod";
import { usageRequestJson as requestJson } from "./UsageReadFeedback";
import { dashboardFetch, deriveErrorMessage, getApiBaseUrl } from "../../platform/api/HttpApiClient";
import { readServerSentEvents } from "../../playground/api/PlaygroundTransportApi";
import notifications from "../../notifications/logic/NotificationManager";
import type { UsageAiApi, UsageAiEvent } from "../support/UsageAiModels";
const event = z.discriminatedUnion("type", [
	z.object({ type: z.literal("chunk"), content: z.string() }),
	z.object({ type: z.literal("status"), message: z.string() }),
	z.object({
		type: z.literal("tool_call"),
		tool_name: z.string(),
		tool_label: z.string(),
		arguments: z.record(z.string(), z.string()),
		status: z.enum(["running", "complete", "error"]),
		error: z.string().optional(),
	}),
	z.object({ type: z.literal("done") }),
	z.object({ type: z.literal("error"), message: z.string() }),
]);
export const usageAiApi: UsageAiApi = {
	models: (signal) =>
		requestJson("/model_group/info", { signal }, (v) =>
			z
				.object({ data: z.array(z.object({ model_group: z.string() }).passthrough()) })
				.parse(v)
				.data.map((row) => row.model_group)
				.sort(),
		),
	async *stream(messages, model, signal): AsyncGenerator<UsageAiEvent> {
		const response = await dashboardFetch(getApiBaseUrl() + "/usage/ai/chat", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ messages, model }),
			signal,
		});
		if (!response.ok) {
			const payload: unknown = await response.json().catch(() => undefined),
				message = deriveErrorMessage(payload);
			notifications.fromBackend(message);
			throw new Error(message);
		}
		for await (const value of readServerSentEvents(response, signal, { skipMalformed: true })) {
			const parsed = event.safeParse(value);
			if (parsed.success) yield parsed.data;
		}
	},
};
