import type { NextFunction, Request, RequestHandler, Response } from "express";
import { ApiError } from "../core/api/ApiError";
import type { UserAPIKeyAuth } from "../types/auth";
import { PROXY_ADMIN_ROLE } from "../types/webUiSession";
import type { AuthRepository } from "./AuthRepository";

const PROXY_ADMIN_VIEWER_ROLE = "proxy_admin_viewer";

const ROUTE_GROUPS: Readonly<Record<string, readonly string[]>> = {
	llm_api_routes: [
		"/chat/completions",
		"/v1/chat/completions",
		"/completions",
		"/v1/completions",
		"/embeddings",
		"/v1/embeddings",
		"/messages",
		"/v1/messages",
		"/v1/messages/count_tokens",
		"/v1/messages/batches",
		"/v1/messages/batches/*",
		"/v1/messages/batches/*/cancel",
		"/v1/messages/batches/*/results",
		"/v1/files",
		"/v1/files/*",
		"/v1/files/*/content",
		"/moderations",
		"/v1/moderations",
		"/audio/*",
		"/v1/audio/*",
		"/images/*",
		"/v1/images/*",
		"/responses",
		"/responses/*",
		"/v1/responses",
		"/v1/responses/*",
		"/engines/*/chat/completions",
		"/openai/deployments/*/chat/completions",
		"/models",
		"/v1/models",
	],
	info_routes: ["/key/info", "/v2/key/info", "/key/list", "/team/info", "/team/list", "/user/info", "/models", "/v1/models"],
	key_management_routes: ["/key/*", "/v2/key/info"],
	management_routes: ["/key/*", "/v2/key/info", "/team/*", "/organization/*", "/user/*", "/customer/*", "/model/*"],
};

/**
 *
 */
export type AuthorizationCapability = "inference" | "management" | "spend" | "authenticated";
/**
 *
 */
export type KeyAccessAction = "read" | "write";

/**
 *
 */
export interface KeyAuthorizationRow {
	/**
	 *
	 */
	readonly token: string;
	/**
	 *
	 */
	readonly userId?: string | null;
	/**
	 *
	 */
	readonly teamId?: string | null;
	/**
	 *
	 */
	readonly organizationId?: string | null;
	/**
	 *
	 */
	readonly projectId?: string | null;
}

function isReadMethod(method: string): boolean {
	return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

function matchesRoutePattern(path: string, pattern: string): boolean {
	if (path === pattern) {
		return true;
	}
	const pathSegments = path.split("/").filter(Boolean);
	const patternSegments = pattern.split("/").filter(Boolean);
	if (pathSegments.length !== patternSegments.length) {
		return false;
	}
	return patternSegments.every((segment, index) => segment === "*" || segment === pathSegments[index]);
}

function isRouteAllowed(path: string, allowedRoutes: readonly string[] | undefined): boolean {
	if (!allowedRoutes || allowedRoutes.length === 0) {
		return true;
	}
	return allowedRoutes.some((allowedRoute) => {
		const patterns = ROUTE_GROUPS[allowedRoute] ?? [allowedRoute];
		return patterns.some((pattern) => matchesRoutePattern(path, pattern));
	});
}

function isProxyAdmin(auth: UserAPIKeyAuth): boolean {
	return auth.user_role === PROXY_ADMIN_ROLE;
}

function isProxyAdminViewer(auth: UserAPIKeyAuth): boolean {
	return auth.user_role === PROXY_ADMIN_VIEWER_ROLE;
}

function teamRole(team: Awaited<ReturnType<AuthRepository["findTeamById"]>>, userId: string): "admin" | "member" | null {
	if (!team) {
		return null;
	}
	if (team.admins.includes(userId)) {
		return "admin";
	}
	const roles = (team.membersWithRoles as Record<string, { role?: string }> | null) ?? null;
	if (roles?.[userId]?.role === "admin") {
		return "admin";
	}
	if (team.members.includes(userId) || roles?.[userId]?.role === "member") {
		return "member";
	}
	return null;
}

/** 集中执行路由 allowlist、管理角色和密钥对象级授权。 */
export class AuthorizationGuard {
	constructor(private readonly _repository: AuthRepository) {}

	/**
	 * @param capability
	 */
	middleware(capability: AuthorizationCapability): RequestHandler {
		return (req: Request, _res: Response, next: NextFunction): void => {
			try {
				const auth = this._requireAuth(req.auth);
				if (!isRouteAllowed(req.path, auth.allowed_routes)) {
					throw ApiError.forbidden("API key is not allowed to access this route");
				}
				if (capability === "management" && !req.path.startsWith("/key/") && req.path !== "/v2/key/info") {
					if (!isProxyAdmin(auth) && !(isProxyAdminViewer(auth) && isReadMethod(req.method))) {
						throw ApiError.forbidden("Management endpoint requires proxy admin access");
					}
				}
				next();
			} catch (error) {
				next(error);
			}
		};
	}

	/**
	 * @param authValue
	 * @param targetTeamId
	 */
	assertCanCreateKey(authValue: UserAPIKeyAuth | undefined, targetTeamId?: string | null): Promise<void> {
		const auth = this._requireAuth(authValue);
		if (isProxyAdmin(auth)) {
			return Promise.resolve();
		}
		if (!targetTeamId || !auth.user_id) {
			return Promise.reject(ApiError.forbidden("Key creation requires proxy admin or team admin access"));
		}
		return this._repository.findTeamById(targetTeamId).then((team) => {
			if (teamRole(team, auth.user_id!) !== "admin") {
				throw ApiError.forbidden("Key creation requires proxy admin or team admin access");
			}
		});
	}

	/**
	 * @param authValue
	 * @param rows
	 * @param action
	 */
	async assertKeyAccess(
		authValue: UserAPIKeyAuth | undefined,
		rows: readonly KeyAuthorizationRow[],
		action: KeyAccessAction,
	): Promise<void> {
		const auth = this._requireAuth(authValue);
		if (isProxyAdmin(auth)) {
			return;
		}
		if (isProxyAdminViewer(auth) && action === "write") {
			throw ApiError.forbidden("Viewer role is read-only");
		}
		for (const row of rows) {
			if (!(await this._canAccessKey(auth, row, action))) {
				throw ApiError.forbidden("Not authorized to access one or more keys");
			}
		}
	}

	/**
	 * @param authValue
	 * @param rows
	 */
	async filterVisibleKeys<T extends KeyAuthorizationRow>(authValue: UserAPIKeyAuth | undefined, rows: readonly T[]): Promise<T[]> {
		const auth = this._requireAuth(authValue);
		if (isProxyAdmin(auth) || isProxyAdminViewer(auth)) {
			return [...rows];
		}
		const visible: T[] = [];
		for (const row of rows) {
			if (await this._canAccessKey(auth, row, "read")) {
				visible.push(row);
			}
		}
		return visible;
	}

	private async _canAccessKey(auth: UserAPIKeyAuth, row: KeyAuthorizationRow, action: KeyAccessAction): Promise<boolean> {
		if ((auth.token && row.token === auth.token) || (auth.user_id && row.userId === auth.user_id)) {
			return true;
		}
		if (row.teamId && auth.user_id) {
			const role = teamRole(await this._repository.findTeamById(row.teamId), auth.user_id);
			if (role === "admin" || (role === "member" && action === "read")) {
				return true;
			}
		}
		if (action === "read" && row.organizationId && row.organizationId === auth.organization_id) {
			return true;
		}
		if (action === "read" && row.projectId && row.projectId === auth.project_id) {
			return true;
		}
		return false;
	}

	private _requireAuth(auth: UserAPIKeyAuth | undefined): UserAPIKeyAuth {
		if (!auth) {
			throw ApiError.unauthorized("Missing authentication context");
		}
		return auth;
	}
}
