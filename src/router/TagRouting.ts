import { ApiError } from "../core/api/ApiError";
import type { Deployment } from "../types/router";

/**
 * Required (&), excluded (!) and ordinary (OR) tags are evaluated before strategy selection.
 * @param deployments
 * @param params
 * @throws {Error} Rejects invalid input or a denied operation.
 */
export function filterDeploymentsByTags(deployments: Deployment[], params: Record<string, unknown>): Deployment[] {
	const metadata = params["metadata"] as Record<string, unknown> | undefined;
	const raw = metadata?.["tags"];
	if (raw === undefined) {
		return deployments;
	}
	if (raw !== undefined && (!Array.isArray(raw) || raw.some((tag) => typeof tag !== "string"))) {
		throw ApiError.badRequest("metadata.tags must be a string array");
	}
	const requested = (raw ?? []) as string[];
	const excluded = requested.filter((tag) => tag.startsWith("!")).map((tag) => tag.slice(1));
	const required = requested.filter((tag) => tag.startsWith("&")).map((tag) => tag.slice(1));
	const positive = requested.filter((tag) => !tag.startsWith("!") && !tag.startsWith("&"));
	const tagsOf = (dep: Deployment): string[] =>
		(Array.isArray(dep.litellm_params["tags"]) ? (dep.litellm_params["tags"] as string[]) : []);
	const hasDefault = deployments.some((dep) => tagsOf(dep).includes("default"));
	return deployments.filter((dep) => {
		const tags = tagsOf(dep);
		if (excluded.some((tag) => tags.includes(tag)) || !required.every((tag) => tags.includes(tag))) {
			return false;
		}
		if (positive.length > 0) {
			return positive.some((tag) => tags.includes(tag));
		}
		return required.length > 0 || !hasDefault || tags.includes("default");
	});
}

/**
 * Consume proxy routing tags while preserving provider metadata and the caller's object.
 * @param body - Provider payload
 */
export function stripRoutingMetadata(body: Record<string, unknown>): Record<string, unknown> {
	const metadata = body["metadata"];
	if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || !("tags" in metadata)) {return body;}
	const remaining = { ...metadata } as Record<string, unknown>;
	delete remaining["tags"];
	const result = { ...body };
	if (Object.keys(remaining).length) {result["metadata"] = remaining;}
	else {delete result["metadata"];}
	return result;
}
