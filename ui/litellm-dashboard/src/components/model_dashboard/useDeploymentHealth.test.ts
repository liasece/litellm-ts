/* @vitest-environment jsdom */
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useDeploymentHealth } from "./useDeploymentHealth";

const mockAllDeploymentHealthCheckCall = vi.fn();
const mockIndividualModelHealthCheckCall = vi.fn();
const mockLatestHealthChecksCall = vi.fn();

vi.mock("../networking", () => ({
	allDeploymentHealthCheckCall: (...args: unknown[]) => mockAllDeploymentHealthCheckCall(...args),
	individualModelHealthCheckCall: (...args: unknown[]) => mockIndividualModelHealthCheckCall(...args),
	latestHealthChecksCall: (...args: unknown[]) => mockLatestHealthChecksCall(...args),
}));

describe("useDeploymentHealth", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockLatestHealthChecksCall.mockResolvedValue({ latest_health_checks: {} });
	});

	it("hydrates latest statuses by deployment ID and ignores deleted IDs", async () => {
		mockLatestHealthChecksCall.mockResolvedValue({
			latest_health_checks: {
				active: { status: "healthy", checked_at: "2026-07-22T00:00:00.000Z" },
				deleted: { status: "unhealthy", checked_at: "2026-07-22T00:00:00.000Z" },
			},
		});
		const { result } = renderHook(() => useDeploymentHealth("token", ["active"]));

		await act(async () => result.current.hydrateLatest());

		expect(result.current.statuses.active.status).toBe("healthy");
		expect(result.current.statuses.deleted).toBeUndefined();
	});

	it("runs all deployments with exactly one unparameterized health request", async () => {
		mockAllDeploymentHealthCheckCall.mockResolvedValue({
			healthy_count: 1,
			unhealthy_count: 1,
			healthy_endpoints: [{ model_id: "one", model_name: "one", status: "healthy" }],
			unhealthy_endpoints: [{ model_id: "two", model_name: "two", status: "unhealthy", error: "401" }],
		});
		const { result } = renderHook(() => useDeploymentHealth("token", ["one", "two"]));

		await act(async () => result.current.runAll());

		expect(mockAllDeploymentHealthCheckCall).toHaveBeenCalledTimes(1);
		expect(mockAllDeploymentHealthCheckCall).toHaveBeenCalledWith("token");
		expect(mockIndividualModelHealthCheckCall).not.toHaveBeenCalled();
		expect(result.current.statuses.one.status).toBe("healthy");
		expect(result.current.statuses.two.status).toBe("unhealthy");
	});

	it("normalizes structured endpoint errors before storing them in UI state", async () => {
		mockAllDeploymentHealthCheckCall.mockResolvedValue({
			healthy_count: 0,
			unhealthy_count: 1,
			healthy_endpoints: [],
			unhealthy_endpoints: [
				{
					model_id: "one",
					error: { error: { message: "Invalid API key", code: 401 } },
				},
			],
		});
		const { result } = renderHook(() => useDeploymentHealth("token", ["one"]));

		await act(async () => result.current.runAll());

		expect(result.current.statuses.one.status).toBe("unhealthy");
		expect(result.current.statuses.one.fullError).toContain("Invalid API key");
		expect(result.current.statuses.one.fullError).toContain("401");
		expect(result.current.statuses.one.error).toBe("AuthenticationError: 401");
	});

	it("retains prior statuses and clears loading when the all-deployments request fails", async () => {
		mockAllDeploymentHealthCheckCall.mockRejectedValue(new Error("offline"));
		const { result } = renderHook(() => useDeploymentHealth("token", ["one"]));

		await act(async () => result.current.runAll());

		await waitFor(() => expect(result.current.statuses.one.loading).toBe(false));
		expect(result.current.statuses.one.status).toBe("none");
		expect(result.current.error?.message).toBe("offline");
	});

	it("refreshes only the requested deployment", async () => {
		mockIndividualModelHealthCheckCall.mockResolvedValue({
			healthy_count: 1,
			unhealthy_count: 0,
			healthy_endpoints: [{ model_id: "two", status: "healthy" }],
			unhealthy_endpoints: [],
		});
		const { result } = renderHook(() => useDeploymentHealth("token", ["one", "two"]));

		await act(async () => result.current.runOne("two"));

		expect(mockIndividualModelHealthCheckCall).toHaveBeenCalledWith("token", "two");
		expect(mockAllDeploymentHealthCheckCall).not.toHaveBeenCalled();
		expect(result.current.statuses.two.status).toBe("healthy");
		expect(result.current.statuses.one.status).toBe("none");
	});
});
