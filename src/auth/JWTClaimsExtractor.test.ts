/**
 * JWTClaimsExtractor 单元测试
 *
 * 直接覆盖（不经 JWTHandler 间接覆盖）：
 * - getTeamId / getOrgId / getOrgAlias
 * - getUserId / getUserEmail / getUserRole / getRbacRole
 * - getEndUserId / getObjectId / getTeamIds
 * - getNestedValue（静态方法）
 * - isAllowedDomain / isEnforcedEmailDomain
 */

import { JWTClaimsExtractor } from "./JWTClaimsExtractor";

describe("JWTClaimsExtractor", () => {
	let extractor: JWTClaimsExtractor;

	beforeEach(() => {
		extractor = new JWTClaimsExtractor();
	});

	describe("getTeamId", () => {
		it("team_id 优先于 team / teams[0]", () => {
			expect(
				extractor.getTeamId({
					team_id: "primary",
					team: "secondary",
					teams: ["tertiary"],
				}),
			).toBe("primary");
		});

		it("无 team_id 时回退 team", () => {
			expect(extractor.getTeamId({ team: "tt", teams: ["other"] })).toBe("tt");
		});

		it("无 team_id 与 team 时回退 teams[0]", () => {
			expect(extractor.getTeamId({ teams: ["a", "b"] })).toBe("a");
		});

		it("全部缺失时返回 defaultValue", () => {
			expect(extractor.getTeamId({}, "fallback")).toBe("fallback");
			expect(extractor.getTeamId({})).toBeUndefined();
		});

		it("空字符串不命中（PY: not empty 校验）", () => {
			expect(extractor.getTeamId({ team_id: "", team: "valid" })).toBe("valid");
		});

		it("teams[0] 非字符串忽略", () => {
			expect(extractor.getTeamId({ teams: [123, "b"] })).toBeUndefined();
		});
	});

	describe("getOrgId", () => {
		it("org_id 优先于 organization_id / orgs[0]", () => {
			expect(
				extractor.getOrgId({
					// eslint-disable-next-line camelcase
					org_id: "o1",

					organization_id: "o2",
					orgs: ["o3"],
				}),
			).toBe("o1");
		});

		it("回退 organization_id 再回退 orgs[0]", () => {
			expect(extractor.getOrgId({ organization_id: "o2" })).toBe("o2");
			expect(extractor.getOrgId({ orgs: ["o3", "o4"] })).toBe("o3");
		});

		it("全部缺失时使用 defaultValue", () => {
			expect(extractor.getOrgId({}, "def")).toBe("def");
		});
	});

	describe("getOrgAlias", () => {
		it("org_alias 优先于 organization_alias", () => {
			expect(
				extractor.getOrgAlias({
					// eslint-disable-next-line camelcase
					org_alias: "a1",

					organization_alias: "a2",
				}),
			).toBe("a1");
		});

		it("空字符串触发回退", () => {
			// eslint-disable-next-line camelcase
			expect(extractor.getOrgAlias({ org_alias: "", organization_alias: "a2" })).toBe("a2");
		});

		it("缺失回退 defaultValue", () => {
			expect(extractor.getOrgAlias({}, "x")).toBe("x");
		});
	});

	describe("getUserId", () => {
		it("查找顺序 sub > user_id > email > username > preferred_username", () => {
			expect(extractor.getUserId({ sub: "s", user_id: "u" })).toBe("s");

			expect(extractor.getUserId({ user_id: "u", email: "e@x" })).toBe("u");
			expect(extractor.getUserId({ email: "e@x" })).toBe("e@x");
			expect(extractor.getUserId({ username: "n" })).toBe("n");
			// eslint-disable-next-line camelcase
			expect(extractor.getUserId({ preferred_username: "p" })).toBe("p");
		});

		it("全部缺失时使用 defaultValue", () => {
			expect(extractor.getUserId({}, "def")).toBe("def");
		});
	});

	describe("getUserEmail", () => {
		it("email 优先于 user_email", () => {
			expect(extractor.getUserEmail({ email: "a@x", user_email: "b@x" })).toBe("a@x");
		});

		it("缺失回退 defaultValue", () => {
			expect(extractor.getUserEmail({}, "d@x")).toBe("d@x");
		});
	});

	describe("getUserRole / getRbacRole", () => {
		it("getUserRole: rbac_role > roles[0] > role", () => {
			// eslint-disable-next-line camelcase
			expect(extractor.getUserRole({ rbac_role: "admin", roles: ["dev"] })).toBe("admin");
			expect(extractor.getUserRole({ roles: ["dev"], role: "viewer" })).toBe("dev");
			expect(extractor.getUserRole({ role: "viewer" })).toBe("viewer");
			expect(extractor.getUserRole({}, "default")).toBe("default");
		});

		it("getRbacRole: rbac_role > roles[0] > role > scope 首段", () => {
			// eslint-disable-next-line camelcase
			expect(extractor.getRbacRole({ rbac_role: "admin" })).toBe("admin");
			expect(extractor.getRbacRole({ roles: ["dev", "qa"] })).toBe("dev");
			expect(extractor.getRbacRole({ role: "viewer" })).toBe("viewer");
			expect(extractor.getRbacRole({ scope: "openid profile email" })).toBe("openid");
			expect(extractor.getRbacRole({})).toBeUndefined();
		});

		it("scope 为空字符串不命中", () => {
			expect(extractor.getRbacRole({ scope: "" })).toBeUndefined();
		});
	});

	describe("getEndUserId", () => {
		it("end_user_id > end_user > sub", () => {
			expect(extractor.getEndUserId({ end_user_id: "e1", sub: "s" })).toBe("e1");
			// eslint-disable-next-line camelcase
			expect(extractor.getEndUserId({ end_user: "e2", sub: "s" })).toBe("e2");
			expect(extractor.getEndUserId({ sub: "s" })).toBe("s");
			expect(extractor.getEndUserId({})).toBeUndefined();
		});
	});

	describe("getObjectId", () => {
		it("object_id 优先于 oid", () => {
			// eslint-disable-next-line camelcase
			expect(extractor.getObjectId({ object_id: "o1", oid: "o2" })).toBe("o1");
			expect(extractor.getObjectId({ oid: "o2" })).toBe("o2");
			expect(extractor.getObjectId({}, "def")).toBe("def");
		});
	});

	describe("getTeamIds", () => {
		it("teams[] 优先于 team_ids[]，过滤非字符串", () => {
			// eslint-disable-next-line camelcase
			expect(extractor.getTeamIds({ teams: ["a", "b", 1, ""], team_ids: ["x"] })).toEqual(["a", "b"]);
			// eslint-disable-next-line camelcase
			expect(extractor.getTeamIds({ team_ids: ["x", "y", null, ""] })).toEqual(["x", "y"]);
		});

		it("空数组与缺失回退 defaultValue", () => {
			expect(extractor.getTeamIds({}, ["d"])).toEqual(["d"]);
			expect(extractor.getTeamIds({ teams: [] }, ["d"])).toEqual(["d"]);
		});
	});

	describe("isAllowedDomain", () => {
		it("命中允许域名（大小写不敏感）", () => {
			expect(extractor.isAllowedDomain("user@Example.com", ["example.com"])).toBe(true);
			expect(extractor.isAllowedDomain("user@EXAMPLE.com", ["Example.com"])).toBe(true);
		});

		it("未命中或参数无效返回 false", () => {
			expect(extractor.isAllowedDomain("user@other.com", ["example.com"])).toBe(false);
			expect(extractor.isAllowedDomain(undefined, ["example.com"])).toBe(false);
			expect(extractor.isAllowedDomain("no-at-sign", ["example.com"])).toBe(false);
		});
	});

	describe("isEnforcedEmailDomain", () => {
		it("布尔 true / 字符串 true 均视为启用", () => {
			// eslint-disable-next-line camelcase
			expect(extractor.isEnforcedEmailDomain({ enforced_email_domain: true })).toBe(true);
			// eslint-disable-next-line camelcase
			expect(extractor.isEnforcedEmailDomain({ enforced_email_domain: "true" })).toBe(true);
		});

		it("其它值视为未启用", () => {
			// eslint-disable-next-line camelcase
			expect(extractor.isEnforcedEmailDomain({ enforced_email_domain: false })).toBe(false);
			// eslint-disable-next-line camelcase
			expect(extractor.isEnforcedEmailDomain({ enforced_email_domain: "1" })).toBe(false);
			expect(extractor.isEnforcedEmailDomain({})).toBe(false);
		});
	});

	describe("getNestedValue", () => {
		it("点分隔路径访问嵌套对象", () => {
			const data = {
				user: {
					email: "u@x",
					profile: { roles: ["admin"] },
				},
			};
			expect(JWTClaimsExtractor.getNestedValue(data, "user.email")).toBe("u@x");
			expect(JWTClaimsExtractor.getNestedValue(data, "user.profile.roles")).toEqual(["admin"]);
		});

		it("中间节点 null/undefined 直接返回 undefined", () => {
			expect(JWTClaimsExtractor.getNestedValue({ a: { b: null } }, "a.b.c")).toBeUndefined();
			expect(JWTClaimsExtractor.getNestedValue({}, "a.b")).toBeUndefined();
		});

		it("中间节点非对象返回 undefined", () => {
			expect(JWTClaimsExtractor.getNestedValue({ a: "string" }, "a.b")).toBeUndefined();
			expect(JWTClaimsExtractor.getNestedValue({ a: 42 }, "a.b")).toBeUndefined();
		});

		it("空 path 或空 data 返回 undefined", () => {
			expect(JWTClaimsExtractor.getNestedValue({}, "")).toBeUndefined();
			expect(JWTClaimsExtractor.getNestedValue(null as unknown as Record<string, unknown>, "x")).toBeUndefined();
		});
	});
});
