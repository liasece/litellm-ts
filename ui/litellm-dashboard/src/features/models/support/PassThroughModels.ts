export interface PassThroughGuardrail {
	request_fields?: string[];
	response_fields?: string[];
}
export type PassThroughGuardrails = Record<string, PassThroughGuardrail | null>;
export interface PassThroughEndpoint extends Record<string, unknown> {
	id?: string;
	path: string;
	target: string;
	headers: Record<string, unknown>;
	include_subpath?: boolean;
	cost_per_request?: number | null;
	auth?: boolean;
	methods?: string[];
	guardrails?: PassThroughGuardrails;
	default_query_params?: Record<string, string>;
}
export const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH"];
export interface PassThroughDraft {
	path: string;
	target: string;
	headers?: Record<string, unknown>;
	headersText: string;
	default_query_params?: Record<string, string>;
	include_subpath: boolean;
	cost_per_request: number | null;
	auth?: boolean;
	methods?: string[];
	guardrails: PassThroughGuardrails;
}
export function createPassThroughDraft(endpoint?: PassThroughEndpoint): PassThroughDraft {
	return {
		path: endpoint?.path ?? "",
		target: endpoint?.target ?? "",
		headers: endpoint?.headers,
		headersText: endpoint ? JSON.stringify(endpoint.headers ?? {}, null, 2) : "",
		default_query_params: endpoint?.default_query_params,
		include_subpath: endpoint?.include_subpath ?? true,
		cost_per_request: endpoint?.cost_per_request ?? null,
		auth: endpoint?.auth,
		methods: endpoint?.methods,
		guardrails: endpoint?.guardrails ?? {},
	};
}
export function passThroughPayload(draft: PassThroughDraft, premium: boolean, edit = false): Record<string, unknown> {
	let headers: unknown = draft.headers;
	if (edit)
		try {
			headers = draft.headersText ? JSON.parse(draft.headersText) : {};
		} catch {
			throw new Error("Invalid JSON format for headers");
		}
	const value: Record<string, unknown> = {
		path: draft.path,
		target: draft.target,
		headers,
		include_subpath: draft.include_subpath,
		cost_per_request: draft.cost_per_request ?? undefined,
		auth: premium ? draft.auth : undefined,
		methods: edit ? (draft.methods?.length ? draft.methods : undefined) : draft.methods,
		guardrails: Object.keys(draft.guardrails).length ? draft.guardrails : undefined,
	};
	if (!edit) value.default_query_params = draft.default_query_params;
	return value;
}
