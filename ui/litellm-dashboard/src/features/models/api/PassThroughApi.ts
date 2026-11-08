import { z } from "zod";
import { requestJson } from "../../platform/api/HttpApiClient";
import type { PassThroughEndpoint } from "../support/PassThroughModels";
const record = z.record(z.string(), z.unknown());
const schema = z.object({ path: z.string(), target: z.string(), headers: record.default({}) }).passthrough();
export function listPassThrough(): Promise<PassThroughEndpoint[]> {
	return requestJson(
		"/config/pass_through_endpoint",
		{},
		(payload) => z.object({ endpoints: z.array(schema).default([]) }).parse(payload).endpoints as PassThroughEndpoint[],
	);
}
export function createPassThrough(value: Record<string, unknown>): Promise<PassThroughEndpoint[]> {
	return requestJson(
		"/config/pass_through_endpoint",
		{ method: "POST", body: JSON.stringify(value) },
		(payload) => z.object({ endpoints: z.array(schema).default([]) }).parse(payload).endpoints as PassThroughEndpoint[],
	);
}
export function updatePassThrough(id: string, value: Record<string, unknown>): Promise<unknown> {
	return requestJson("/config/pass_through_endpoint/" + encodeURIComponent(id), { method: "POST", body: JSON.stringify(value) });
}
export function deletePassThrough(id: string): Promise<unknown> {
	return requestJson("/config/pass_through_endpoint?endpoint_id=" + encodeURIComponent(id), { method: "DELETE" });
}
