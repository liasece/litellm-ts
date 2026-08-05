import type { Deployment } from "../types/router";
import { validateReasoningEffortOverride } from "./ReasoningEffortOverride";

export const MODEL_OVERRIDE_FIELD = "override_model_name";

/**
 * Build the forced model-group redirects stored on deployments.
 * Deployments in the same model group must agree on one target, and redirect
 * cycles are rejected before they can make requests recurse indefinitely.
 */
export function buildModelGroupOverrides(deployments: readonly Deployment[]): Record<string, string> {
	const overrides: Record<string, string> = {};

	for (const deployment of deployments) {
		validateReasoningEffortOverride(deployment);
		const rawTarget = deployment.model_info?.[MODEL_OVERRIDE_FIELD];
		if (rawTarget === undefined || rawTarget === null || rawTarget === "") {
			continue;
		}
		if (typeof rawTarget !== "string" || rawTarget.trim().length === 0) {
			throw new Error(`${MODEL_OVERRIDE_FIELD} must be a non-empty string`);
		}
		const target = rawTarget.trim();
		const existing = overrides[deployment.model_name];
		if (existing !== undefined && existing !== target) {
			throw new Error(`Model group "${deployment.model_name}" has conflicting overrides: "${existing}" and "${target}"`);
		}
		overrides[deployment.model_name] = target;
	}

	for (const source of Object.keys(overrides)) {
		const path = [source];
		const seen = new Set(path);
		let current = source;
		while (overrides[current] !== undefined) {
			const target = overrides[current]!;
			if (seen.has(target)) {
				throw new Error(`Model override cycle detected: ${[...path, target].join(" -> ")}`);
			}
			path.push(target);
			seen.add(target);
			current = target;
		}
	}

	return overrides;
}
