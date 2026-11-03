/**
 * Built-in provider quota endpoint.
 *
 * Admin-only: the response contains upstream account balances, which are
 * financial data. Plaintext keys stay on the server and never appear in the
 * response or logs.
 */
import type { Router } from "express";
import { registerRoute } from "../core/api/registerRoute";
import type { ProviderQuotaService } from "../providerusage/ProviderQuotaService";
import type { CredentialValuesAccessor, Deployment } from "../types/router";

/** Read-only router view the endpoint depends on. */
export interface ProviderQuotaRouterView {
	/**
	 * Deployments from the current request snapshot.
	 */
	getDeployments(): Deployment[];
	/**
	 * Credential accessor from the current request snapshot.
	 */
	listCredentialValues(): CredentialValuesAccessor | undefined;
}

/**
 * Register the built-in provider quota endpoint.
 * @param router - express router with auth, CSRF and runtime config middleware
 * @param service - quota service
 * @param routerView - router providing deployments and credentials
 */
export function registerProviderQuotaRoutes(router: Router, service: ProviderQuotaService, routerView: ProviderQuotaRouterView): void {
	registerRoute(router, { method: "get", path: "/provider/quota" }, async (req) => {
		const refresh = req.query["refresh"] === "true" || req.query["refresh"] === "1";
		const accounts = await service.list(routerView.listCredentialValues(), routerView.getDeployments(), refresh);
		return { data: accounts };
	});
}
