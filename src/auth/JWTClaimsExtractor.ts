/**
 * JWTClaimsExtractor — 拆出 JWT claim 提取与嵌套读取
 *
 * 把 JWTHandler 中的 claim 派生逻辑（getTeamId / getOrgId / getUserId 等）
 * 集中到本类，让 JWTHandler 只负责验签 (verifyJwt) 与 JWKS 解析。
 *
 * 对齐 PY `litellm/proxy/auth/handle_jwt.py:62-764` 各类 get_*_from_jwt helpers。
 */
/**
 * Claims 提取器（无状态）
 *
 * 设计：所有 getXxx 方法接收 claims + 可选 defaultValue，返回 string / string[] / undefined。
 * 校验规则（嵌套读取 fallback 顺序）由各方法独立实现，调用方无需关心底层 token 解析。
 */
export class JWTClaimsExtractor {
	/**
	 * 从 JWT claims 提取 team_id，对齐 PY `get_team_id_from_jwt`。
	 * 查找顺序：team_id > team > teams[0] > org_id 兜底。
	 * @param claims
	 * @param defaultValue - 缺省值（可选）
	 */
	getTeamId(claims: Record<string, unknown>, defaultValue?: string): string | undefined {
		const direct = claims["team_id"];
		if (typeof direct === "string" && direct.length > 0) {
			return direct;
		}
		const team = claims["team"];
		if (typeof team === "string" && team.length > 0) {
			return team;
		}
		const teams = claims["teams"];
		if (Array.isArray(teams) && teams.length > 0 && typeof teams[0] === "string") {
			return teams[0] as string;
		}
		return defaultValue;
	}

	/**
	 * 从 JWT claims 提取 organization_id（org_id），对齐 PY `get_org_id_from_jwt`。
	 * @param claims
	 * @param defaultValue
	 */
	getOrgId(claims: Record<string, unknown>, defaultValue?: string): string | undefined {
		const direct = claims["org_id"];
		if (typeof direct === "string" && direct.length > 0) {
			return direct;
		}
		const org = claims["organization_id"];
		if (typeof org === "string" && org.length > 0) {
			return org;
		}
		const orgs = claims["orgs"];
		if (Array.isArray(orgs) && orgs.length > 0 && typeof orgs[0] === "string") {
			return orgs[0] as string;
		}
		return defaultValue;
	}

	/**
	 * 从 JWT claims 提取 organization alias，对齐 PY `get_org_alias_from_jwt`。
	 * @param claims
	 * @param defaultValue
	 */
	getOrgAlias(claims: Record<string, unknown>, defaultValue?: string): string | undefined {
		const direct = claims["org_alias"];
		if (typeof direct === "string" && direct.length > 0) {
			return direct;
		}
		const alias = claims["organization_alias"];
		if (typeof alias === "string" && alias.length > 0) {
			return alias;
		}
		return defaultValue;
	}

	/**
	 * 检查 email 域名是否在 allowed 列表中，对齐 PY `is_allowed_domain`。
	 * @param email
	 * @param allowedDomains
	 */
	isAllowedDomain(email: string | undefined, allowedDomains: string[]): boolean {
		if (!email || !email.includes("@")) {
			return false;
		}
		const domain = email.split("@").pop()?.toLowerCase() ?? "";
		return allowedDomains.some((d) => d.toLowerCase() === domain);
	}

	/**
	 * 从 JWT claims 提取 RBAC role，对齐 PY `get_rbac_role_from_jwt`。
	 * 查找顺序：rbac_role > roles[0] > role > scope 字符串拆分取首个。
	 * @param claims
	 */
	getRbacRole(claims: Record<string, unknown>): string | undefined {
		const rbacRole = claims["rbac_role"];
		if (typeof rbacRole === "string" && rbacRole.length > 0) {
			return rbacRole;
		}
		const roles = claims["roles"];
		if (Array.isArray(roles) && roles.length > 0 && typeof roles[0] === "string") {
			return roles[0] as string;
		}
		const role = claims["role"];
		if (typeof role === "string" && role.length > 0) {
			return role;
		}
		const scope = claims["scope"];
		if (typeof scope === "string") {
			const first = scope.split(" ")[0];
			if (first && first.length > 0) {
				return first;
			}
		}
		return undefined;
	}

	/**
	 * 检查是否启用 enforced email domain，对齐 PY `is_enforced_email_domain`。
	 * @param claims
	 */
	isEnforcedEmailDomain(claims: Record<string, unknown>): boolean {
		const flag = claims["enforced_email_domain"];
		return flag === true || flag === "true";
	}

	/**
	 * 从 JWT claims 提取 end_user_id（用于 spend log），对齐 PY `get_end_user_id_from_jwt`。
	 * @param claims
	 */
	getEndUserId(claims: Record<string, unknown>): string | undefined {
		const direct = claims["end_user_id"];
		if (typeof direct === "string" && direct.length > 0) {
			return direct;
		}
		const endUser = claims["end_user"];
		if (typeof endUser === "string" && endUser.length > 0) {
			return endUser;
		}
		const sub = claims["sub"];
		if (typeof sub === "string" && sub.length > 0) {
			return sub;
		}
		return undefined;
	}

	/**
	 * 嵌套路径访问工具，对齐 PY `get_nested_value` (handle_jwt.py:96-117)。
	 * 支持 `user.email` / `resource_access.client.roles` 等点分隔路径访问嵌套对象。
	 * @param data
	 * @param path
	 */
	static getNestedValue(data: Record<string, unknown>, path: string): unknown {
		if (!data || !path) {
			return undefined;
		}
		const keys = path.split(".");
		let current: unknown = data;
		for (const key of keys) {
			if (current === null || current === undefined) {
				return undefined;
			}
			if (typeof current !== "object") {
				return undefined;
			}
			current = (current as Record<string, unknown>)[key];
		}
		return current;
	}

	/**
	 * 从 JWT claims 提取 user_id，对齐 PY `get_user_id` (handle_jwt.py:295-313)。
	 * 查找顺序：sub > user_id > email > username > 默认值。
	 * @param claims
	 * @param defaultValue
	 */
	getUserId(claims: Record<string, unknown>, defaultValue?: string): string | undefined {
		const sub = claims["sub"];
		if (typeof sub === "string" && sub.length > 0) {
			return sub;
		}
		const userId = claims["user_id"];
		if (typeof userId === "string" && userId.length > 0) {
			return userId;
		}
		const email = claims["email"];
		if (typeof email === "string" && email.length > 0) {
			return email;
		}
		const username = claims["username"] ?? claims["preferred_username"];
		if (typeof username === "string" && username.length > 0) {
			return username;
		}
		return defaultValue;
	}

	/**
	 * 从 JWT claims 提取 user_email，对齐 PY `get_user_email` (handle_jwt.py:388-401)。
	 * @param claims
	 * @param defaultValue
	 */
	getUserEmail(claims: Record<string, unknown>, defaultValue?: string): string | undefined {
		const email = claims["email"];
		if (typeof email === "string" && email.length > 0) {
			return email;
		}
		const userEmail = claims["user_email"];
		if (typeof userEmail === "string" && userEmail.length > 0) {
			return userEmail;
		}
		return defaultValue;
	}

	/**
	 * 从 JWT claims 提取 user_role，对齐 PY `get_user_role`。
	 * 单值：rbac_role > roles[0] > role > 默认值。
	 * @param claims
	 * @param defaultValue
	 */
	getUserRole(claims: Record<string, unknown>, defaultValue?: string): string | undefined {
		const rbacRole = claims["rbac_role"];
		if (typeof rbacRole === "string" && rbacRole.length > 0) {
			return rbacRole;
		}
		const roles = claims["roles"];
		if (Array.isArray(roles) && roles.length > 0 && typeof roles[0] === "string") {
			return roles[0] as string;
		}
		const role = claims["role"];
		if (typeof role === "string" && role.length > 0) {
			return role;
		}
		return defaultValue;
	}

	/**
	 * 从 JWT claims 提取 object_id（通用资源 id），对齐 PY `get_object_id` (handle_jwt.py:402-420)。
	 * 查找顺序：object_id > oid > 默认值。
	 * @param claims
	 * @param defaultValue
	 */
	getObjectId(claims: Record<string, unknown>, defaultValue?: string): string | undefined {
		const objectId = claims["object_id"];
		if (typeof objectId === "string" && objectId.length > 0) {
			return objectId;
		}
		const oid = claims["oid"];
		if (typeof oid === "string" && oid.length > 0) {
			return oid;
		}
		return defaultValue;
	}

	/**
	 * 从 JWT claims 提取 team_ids（多值），对齐 PY `get_team_ids_from_jwt` (handle_jwt.py:169-191)。
	 * 查找顺序：teams[] > team_ids[] > 默认值。
	 * @param claims
	 * @param defaultValue
	 */
	getTeamIds(claims: Record<string, unknown>, defaultValue?: string[]): string[] | undefined {
		const teams = claims["teams"];
		if (Array.isArray(teams) && teams.length > 0) {
			return teams.filter((t): t is string => typeof t === "string" && t.length > 0);
		}
		const teamIds = claims["team_ids"];
		if (Array.isArray(teamIds) && teamIds.length > 0) {
			return teamIds.filter((t): t is string => typeof t === "string" && t.length > 0);
		}
		return defaultValue;
	}
}
