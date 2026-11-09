import type { Router } from "../router/Router";
import type { Deployment } from "../types/router";
import { hostedProvider, subscriptionTarget, type SubscriptionConnection } from "./SubscriptionProviders";

/** The public alias and exact upstream model selected for a native request. */
export interface HostedModel {
	/** Public alias used for access checks and logs. */
	readonly publicModel: string;
	/** Model identifier registered by the subscription worker. */
	readonly upstreamModel: string;
	/** Deployment that owns routing and pricing settings. */
	readonly deployment: Deployment;
}

/**
 * Resolve aliases through the Router first. Raw upstream IDs are allowed only for configured models.
 * @param router
 * @param connection
 * @param requested
 */
export function resolveHostedModel(router: Router, connection: SubscriptionConnection, requested: string): HostedModel | null {
	const selected = router.getAvailableDeployment(requested)?.deployment;
	if (selected && hostedProvider(selected.litellm_params)) {
		return {
			publicModel: requested,
			upstreamModel: subscriptionTarget(connection, selected.litellm_params, "").model,
			deployment: selected,
		};
	}

	let match: HostedModel | null = null;
	for (const deployment of router.getDeployments?.() ?? []) {
		if (!hostedProvider(deployment.litellm_params)) {
			continue;
		}
		const upstreamModel = subscriptionTarget(connection, deployment.litellm_params, "").model;
		if (requested === upstreamModel) {
			// A raw ID cannot choose between different subscriptions sharing it.
			if (match && hostedProvider(match.deployment.litellm_params) !== hostedProvider(deployment.litellm_params)) {
				return null;
			}
			match ??= { publicModel: deployment.model_name, upstreamModel: upstreamModel, deployment: deployment };
		}
	}
	return match;
}
