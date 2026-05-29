/**
 * RoutingStrategies 测试
 */
import { simpleShuffle, leastBusy, usageBasedRouting, latencyBasedRouting, deploymentKey } from "./RoutingStrategies";
import type { Deployment } from "../types/router";

function mkDeployment(name: string, tpm = 100000, rpm = 100): Deployment {
	return {
		model_name: name,
		litellm_params: { model: name, tpm: tpm, rpm: rpm },
		model_info: { id: name },
	};
}

function mkContext(usage: Record<string, { tpm: number; rpm: number }>, active: Record<string, number>, lats: Record<string, number>) {
	return {
		deployments: [],
		tpmRpmLimiter: {
			getUsage: (name: string) => usage[name] ?? { tpm: 0, rpm: 0 },
		},
		activeRequests: new Map(Object.entries(active)),
		latencies: new Map(Object.entries(lats)),
	};
}

describe("simpleShuffle", () => {
	it("picks from available deployments", () => {
		const deps = [mkDeployment("gpt-4"), mkDeployment("gpt-4-turbo")];
		const ctx = mkContext({}, {}, {});
		const result = simpleShuffle(deps, ctx);
		expect(result).not.toBeNull();
		expect(["gpt-4", "gpt-4-turbo"]).toContain(result!.model_name);
	});

	it("returns null for empty list", () => {
		expect(simpleShuffle([], mkContext({}, {}, {}))).toBeNull();
	});

	it("pure random when no weight/rpm/tpm params", () => {
		const deps = [
			{ model_name: "a", litellm_params: { model: "a" } },
			{ model_name: "b", litellm_params: { model: "b" } },
		] as Deployment[];
		const ctx = mkContext({}, {}, {});
		let aWins = 0;
		for (let i = 0; i < 100; i++) {
			const result = simpleShuffle(deps, ctx);
			if (result?.model_name === "a") {
				aWins++;
			}
		}
		expect(aWins).toBeGreaterThan(20);
		expect(aWins).toBeLessThan(80);
	});

	it("weights by rpm when all deployments have rpm", () => {
		const depHigh = mkDeployment("high", 100000, 100);
		const depLow = mkDeployment("low", 100000, 10);
		const ctx = mkContext({}, {}, {});
		let highWins = 0;
		for (let i = 0; i < 100; i++) {
			const result = simpleShuffle([depHigh, depLow], ctx);
			if (result?.model_name === "high") {
				highWins++;
			}
		}
		expect(highWins).toBeGreaterThan(60);
	});
});

describe("leastBusy", () => {
	it("picks deployment with fewest active requests", () => {
		const deps = [mkDeployment("a"), mkDeployment("b")];
		const ctx = mkContext({}, { a: 5, b: 2 }, {});
		expect(leastBusy(deps, ctx)!.model_name).toBe("b");
	});
});

describe("usageBasedRouting", () => {
	it("picks deployment with lowest usage ratio", () => {
		const deps = [mkDeployment("a", 100000, 100), mkDeployment("b", 100000, 100)];
		const ctx = mkContext({ a: { tpm: 50000, rpm: 50 }, b: { tpm: 10000, rpm: 10 } }, {}, {});
		expect(usageBasedRouting(deps, ctx)!.model_name).toBe("b");
	});
});

describe("latencyBasedRouting", () => {
	it("picks deployment with lowest latency", () => {
		const deps = [mkDeployment("fast"), mkDeployment("slow")];
		const ctx = mkContext({}, {}, { fast: 100, slow: 500 });
		expect(latencyBasedRouting(deps, ctx)!.model_name).toBe("fast");
	});

	it("falls back to any deployment when no latency data", () => {
		const deps = [mkDeployment("a")];
		const ctx = mkContext({}, {}, {});
		const result = latencyBasedRouting(deps, ctx);
		expect(result).not.toBeNull();
	});
});
