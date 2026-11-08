import { reactive } from "vue";
import { transformRequest } from "../api/TransformRequestApi";
import { initialTransformRequest } from "../support/TransformExamples";
import { formatTransformCurl } from "../logic/TransformRequestLogic";
import { objectValue } from "../../access-control/logic/ResourceDraftLogic";
export function createTransformRequestStore(call: typeof transformRequest = transformRequest) {
	const state = reactive({ request: initialTransformRequest, response: "", loading: false, error: "", message: "" });
	let generation = 0;
	async function transform(authorized: boolean) {
		state.loading = true;
		state.error = "";
		state.message = "";
		let body: unknown;
		try {
			body = JSON.parse(state.request);
		} catch {
			state.error = "Invalid JSON in request body";
			state.loading = false;
			return;
		}
		if (!authorized) {
			state.error = "No access token found";
			state.loading = false;
			return;
		}
		const current = ++generation;
		try {
			const response = await call(body);
			if (current !== generation) return;
			const value = objectValue(response);
			if (value.raw_request_api_base && value.raw_request_body) {
				const headers = objectValue(value.raw_request_headers);
				state.response = formatTransformCurl(
					String(value.raw_request_api_base),
					value.raw_request_body,
					Object.fromEntries(Object.entries(headers).map(([name, value]) => [name, String(value)])),
				);
				state.message = "Request transformed successfully";
			} else {
				state.response = typeof response === "string" ? response : JSON.stringify(response);
				state.message = "Transformed request received in unexpected format";
			}
		} catch {
			if (current === generation) state.error = "Failed to transform request";
		} finally {
			if (current === generation) state.loading = false;
		}
	}
	async function copy() {
		await navigator.clipboard.writeText(state.response || "");
		state.message = "Copied to clipboard";
	}
	function dispose() {
		++generation;
	}
	return { state, transform, copy, dispose };
}
