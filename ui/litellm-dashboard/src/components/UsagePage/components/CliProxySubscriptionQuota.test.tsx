import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dashboardFetch } from "../../networking";
import CliProxySubscriptionQuota from "./CliProxySubscriptionQuota";

vi.mock("../../networking", () => ({
	dashboardFetch: vi.fn(),
}));

function jsonResponse(body: unknown, status = 200): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: vi.fn().mockResolvedValue(body),
	} as unknown as Response;
}

describe("CliProxySubscriptionQuota", () => {
	const mockDashboardFetch = vi.mocked(dashboardFetch);

	beforeEach(() => {
		mockDashboardFetch.mockReset();
	});

	it("stays hidden when no CLIProxy subscription accounts exist", async () => {
		mockDashboardFetch.mockResolvedValueOnce(jsonResponse({ data: [] }));

		render(<CliProxySubscriptionQuota enabled />);

		await waitFor(() => expect(mockDashboardFetch).toHaveBeenCalledWith("/cliproxy/accounts", expect.anything()));
		expect(screen.queryByTestId("cliproxy-subscription-quota")).not.toBeInTheDocument();
	});

	it("shows each subscription account's remaining windows and balance at the bottom section", async () => {
		mockDashboardFetch
			.mockResolvedValueOnce(
				jsonResponse({
					data: [
						{
							auth_index: "codex-account",
							filename: "codex.json",
							provider: "codex",
							email: "owner@example.com",
						},
					],
				}),
			)
			.mockResolvedValueOnce(
				jsonResponse({
					provider: "codex",
					plan: "Plus",
					subscription_expires_at: null,
					windows: [
						{
							id: "weekly",
							label: "Weekly quota",
							remaining_percent: 73.4,
							resets_at: null,
						},
					],
					balances: [{ label: "Included credits", used: 2.5, limit: 10, unit: "USD" }],
					fetched_at: "2026-08-01T00:00:00.000Z",
				}),
			);

		render(<CliProxySubscriptionQuota enabled />);

		expect(await screen.findByText("CLIProxy API subscription quota")).toBeInTheDocument();
		expect(await screen.findByText("owner@example.com")).toBeInTheDocument();
		expect(screen.getByText("Plus")).toBeInTheDocument();
		expect(screen.getByText("73% remaining")).toBeInTheDocument();
		expect(screen.getByText("7.50 USD remaining")).toBeInTheDocument();
	});

	it("refreshes quota without reloading the account list", async () => {
		mockDashboardFetch
			.mockResolvedValueOnce(
				jsonResponse({
					data: [
						{
							auth_index: "codex-account",
							filename: "codex.json",
							provider: "codex",
							email: null,
						},
					],
				}),
			)
			.mockResolvedValueOnce(
				jsonResponse({
					provider: "codex",
					plan: null,
					subscription_expires_at: null,
					windows: [{ id: "weekly", label: "Weekly quota", remaining_percent: 40, resets_at: null }],
					balances: [],
					fetched_at: "2026-08-01T00:00:00.000Z",
				}),
			)
			.mockResolvedValueOnce(
				jsonResponse({
					provider: "codex",
					plan: null,
					subscription_expires_at: null,
					windows: [{ id: "weekly", label: "Weekly quota", remaining_percent: 35, resets_at: null }],
					balances: [],
					fetched_at: "2026-08-01T01:00:00.000Z",
				}),
			);

		render(<CliProxySubscriptionQuota enabled />);
		expect(await screen.findByText("40% remaining")).toBeInTheDocument();

		fireEvent.click(screen.getByTestId("cliproxy-quota-refresh"));

		expect(await screen.findByText("35% remaining")).toBeInTheDocument();
		expect(mockDashboardFetch).toHaveBeenCalledTimes(3);
	});

	it("does not query management APIs when the current user is not an admin", () => {
		render(<CliProxySubscriptionQuota enabled={false} />);

		expect(mockDashboardFetch).not.toHaveBeenCalled();
		expect(screen.queryByTestId("cliproxy-subscription-quota")).not.toBeInTheDocument();
	});
});
