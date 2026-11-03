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

const emptyBuiltIn = () => jsonResponse({ data: [] });

describe("CliProxySubscriptionQuota", () => {
	const mockDashboardFetch = vi.mocked(dashboardFetch);

	beforeEach(() => {
		mockDashboardFetch.mockReset();
	});

	it("stays hidden when neither CLIProxy accounts nor built-in provider keys exist", async () => {
		mockDashboardFetch.mockResolvedValueOnce(jsonResponse({ data: [] })).mockResolvedValueOnce(emptyBuiltIn());

		render(<CliProxySubscriptionQuota enabled />);

		await waitFor(() => expect(mockDashboardFetch).toHaveBeenCalledWith("/cliproxy/accounts", expect.anything()));
		expect(screen.queryByTestId("upstream-account-quota")).not.toBeInTheDocument();
	});

	it("shows each subscription account's remaining windows and balance", async () => {
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
			.mockResolvedValueOnce(emptyBuiltIn())
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

		expect(await screen.findByText("Upstream account quota")).toBeInTheDocument();
		expect(await screen.findByText("owner@example.com")).toBeInTheDocument();
		expect(screen.getByText("Plus")).toBeInTheDocument();
		expect(screen.getByText("73% remaining")).toBeInTheDocument();
		expect(screen.getByText("$7.50 remaining")).toBeInTheDocument();
	});

	it("renders a built-in MiniMax subscription key next to CLIProxy accounts", async () => {
		mockDashboardFetch
			.mockResolvedValueOnce(jsonResponse({ data: [] }))
			.mockResolvedValueOnce(
				jsonResponse({
					data: [
						{
							id: "minimax:minimax-main:",
							provider: "minimax",
							label: "minimax-main",
							models: ["MiniMax-M3"],
							account_kind: "subscription",
							plan: "Explore",
							subscription_expires_at: null,
							windows: [
								{ id: "general-5h", label: "MiniMax · 5-hour", remaining_percent: 81, resets_at: null },
								{ id: "general-weekly", label: "MiniMax · 7-day", remaining_percent: 42, resets_at: null },
							],
							balances: [],
							fetched_at: "2026-11-03T00:00:00.000Z",
						},
					],
				}),
			);

		render(<CliProxySubscriptionQuota enabled />);

		expect(await screen.findByText("minimax-main")).toBeInTheDocument();
		expect(screen.getByText("Subscription key")).toBeInTheDocument();
		expect(screen.getByText("Explore")).toBeInTheDocument();
		expect(screen.getByText("81% remaining")).toBeInTheDocument();
		expect(screen.getByText("42% remaining")).toBeInTheDocument();
	});

	it("shows a pay-as-you-go MiniMax key with its detected kind and explanation", async () => {
		mockDashboardFetch.mockResolvedValueOnce(jsonResponse({ data: [] })).mockResolvedValueOnce(
			jsonResponse({
				data: [
					{
						id: "minimax:payg:",
						provider: "minimax",
						label: "payg",
						models: ["MiniMax-M3"],
						account_kind: "pay_as_you_go",
						plan: null,
						subscription_expires_at: null,
						windows: [],
						balances: [],
						warning:
							"This is a pay-as-you-go key. MiniMax does not expose a public balance API for it, so only the key kind is shown.",
						fetched_at: "2026-11-03T00:00:00.000Z",
					},
				],
			}),
		);

		render(<CliProxySubscriptionQuota enabled />);

		expect(await screen.findByText("payg")).toBeInTheDocument();
		expect(screen.getByText("Pay-as-you-go key")).toBeInTheDocument();
		expect(screen.getByText(/does not expose a public balance API/)).toBeInTheDocument();
	});

	it("renders a DeepSeek balance in its own currency instead of converting it as USD", async () => {
		mockDashboardFetch.mockResolvedValueOnce(jsonResponse({ data: [] })).mockResolvedValueOnce(
			jsonResponse({
				data: [
					{
						id: "deepseek:deepseek-main:",
						provider: "deepseek",
						label: "deepseek-main",
						models: ["deepseek-flash"],
						account_kind: "pay_as_you_go",
						plan: null,
						subscription_expires_at: null,
						windows: [],
						balances: [
							{
								label: "DeepSeek balance (CNY)",
								remaining: 110,
								unit: "CNY",
								details: ["Granted 10.00", "Topped up 100.00"],
							},
						],
						fetched_at: "2026-11-03T00:00:00.000Z",
					},
				],
			}),
		);

		render(<CliProxySubscriptionQuota enabled />);

		expect(await screen.findByText("deepseek-main")).toBeInTheDocument();
		expect(screen.getByText("CNY 110.00 remaining")).toBeInTheDocument();
		expect(screen.getByText("Granted 10.00 · Topped up 100.00")).toBeInTheDocument();
	});

	it("refreshes both sources without reloading the account list", async () => {
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
			.mockResolvedValueOnce(emptyBuiltIn())
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
			)
			.mockResolvedValueOnce(emptyBuiltIn());

		render(<CliProxySubscriptionQuota enabled />);
		expect(await screen.findByText("40% remaining")).toBeInTheDocument();

		fireEvent.click(screen.getByTestId("upstream-quota-refresh"));

		expect(await screen.findByText("35% remaining")).toBeInTheDocument();
		expect(mockDashboardFetch).toHaveBeenCalledWith("/provider/quota?refresh=true", expect.anything());
	});

	it("does not query management APIs when the current user is not an admin", () => {
		render(<CliProxySubscriptionQuota enabled={false} />);

		expect(mockDashboardFetch).not.toHaveBeenCalled();
		expect(screen.queryByTestId("upstream-account-quota")).not.toBeInTheDocument();
	});
});
