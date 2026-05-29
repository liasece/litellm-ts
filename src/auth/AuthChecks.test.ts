/**
 * AuthChecks 授权检查测试
 */
import { isTeamBlocked, canKeyAccessModel, checkBudget, checkParallelRequests, runCommonChecks } from "./AuthChecks";
import { ApiError } from "../core/api/ApiError";
import type { UserAPIKeyAuth } from "../types/auth";

describe("isTeamBlocked", () => {
	it("throws when team is blocked", () => {
		expect(() => isTeamBlocked({ blocked: true })).toThrow(ApiError);
	});

	it("does not throw when team is not blocked", () => {
		expect(() => isTeamBlocked({ blocked: false })).not.toThrow();
		expect(() => isTeamBlocked({})).not.toThrow();
	});
});

describe("canKeyAccessModel", () => {
	it("allows any model when allowedModels is empty", () => {
		expect(canKeyAccessModel("gpt-5", [])).toBe(true);
	});

	it("allows exact match", () => {
		expect(canKeyAccessModel("claude-sonnet", ["claude-sonnet", "gpt-4"])).toBe(true);
	});

	it("rejects non-matching model", () => {
		expect(canKeyAccessModel("deepseek-chat", ["claude-sonnet"])).toBe(false);
	});

	it("allows * wildcard", () => {
		expect(canKeyAccessModel("any-model", ["*"])).toBe(true);
	});

	it("allows anthropic/* prefix wildcard", () => {
		expect(canKeyAccessModel("anthropic/claude-sonnet", ["anthropic/*"])).toBe(true);
	});

	it("rejects non-matching prefix wildcard", () => {
		expect(canKeyAccessModel("openai/gpt-5", ["anthropic/*"])).toBe(false);
	});

	it("resolves model alias before checking", () => {
		const aliases = { "my-model": "claude-sonnet" };
		expect(canKeyAccessModel("my-model", ["claude-sonnet"], aliases)).toBe(true);
	});
});

describe("checkBudget", () => {
	it("throws when spend exceeds maxBudget", () => {
		expect(() => checkBudget(100, 50)).toThrow(ApiError);
	});

	it("throws when spend equals maxBudget", () => {
		expect(() => checkBudget(50, 50)).toThrow(ApiError);
	});

	it("does not throw when spend is under budget", () => {
		expect(() => checkBudget(30, 100)).not.toThrow();
	});

	it("does not throw when maxBudget is null", () => {
		expect(() => checkBudget(100, null)).not.toThrow();
	});
});

describe("checkParallelRequests", () => {
	it("throws when current exceeds max", () => {
		expect(() => checkParallelRequests(10, 5)).toThrow(ApiError);
	});

	it("does not throw when under limit", () => {
		expect(() => checkParallelRequests(3, 10)).not.toThrow();
	});

	it("does not throw when max is null", () => {
		expect(() => checkParallelRequests(999, null)).not.toThrow();
	});
});

describe("runCommonChecks", () => {
	function mkAuth(overrides: Partial<UserAPIKeyAuth> = {}): UserAPIKeyAuth {
		return {
			api_key: "sk-test",
			metadata: {},
			blocked: false,
			...overrides,
		};
	}

	it("throws when auth is blocked", () => {
		expect(() => runCommonChecks(mkAuth({ blocked: true }), "claude-sonnet", null)).toThrow(ApiError);
	});

	it("throws when auth is expired", () => {
		const past = new Date(Date.now() - 86400000).toISOString();
		expect(() => runCommonChecks(mkAuth({ expires: past }), "claude-sonnet", null)).toThrow(ApiError);
	});

	it("does not throw for valid auth without team", () => {
		expect(() => runCommonChecks(mkAuth(), "claude-sonnet", null)).not.toThrow();
	});

	it("throws when team is blocked", () => {
		expect(() => runCommonChecks(mkAuth(), "claude-sonnet", { blocked: true })).toThrow(ApiError);
	});
});
