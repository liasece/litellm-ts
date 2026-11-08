import { requestJson } from "../../platform/api/HttpApiClient";
export function transformRequest(request: unknown): Promise<unknown> {
	return requestJson("/utils/transform_request", {
		method: "POST",
		body: JSON.stringify({ call_type: "completion", request_body: request }),
	});
}
