import { fireEvent, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../../tests/test-utils";
import Sidebar, { menuGroups } from "./leftnav";

vi.mock("../utils/roles", () => {
	return {
		all_admin_roles: ["admin"],
		internalUserRoles: ["internal"],
		rolesWithWriteAccess: ["admin", "internal"],
		isAdminRole: (role: string) => role === "admin",
		isUserTeamAdminForAnyTeam: () => false,
	};
});

const { mockUseAuthorized, mockUseOrganizations } = vi.hoisted(() => {
	const mockUseAuthorized = vi.fn(() => ({
		userId: "test-user-id",
		accessToken: "test-access-token",
		userRole: "admin",
		token: "test-token",
		userEmail: "test@example.com",
		premiumUser: false,
		disabledPersonalKeyCreation: false,
		showSSOBanner: false,
	}));

	const mockUseOrganizations = vi.fn(() => ({
		data: [],
		isLoading: false,
		error: null,
	}));

	return { mockUseAuthorized, mockUseOrganizations };
});

vi.mock("@/app/(dashboard)/hooks/useAuthorized", () => ({
	default: mockUseAuthorized,
}));

vi.mock("@/app/(dashboard)/hooks/organizations/useOrganizations", () => ({
	useOrganizations: mockUseOrganizations,
}));

vi.mock("@/app/(dashboard)/hooks/teams/useTeams", () => ({
	useTeams: () => ({ data: [], isLoading: false, error: null }),
}));

vi.mock("@/app/(dashboard)/hooks/uiConfig/useUIConfig", () => {
	return {
		useUIConfig: () => ({
			data: { admin_ui_disabled: false },
			isLoading: false,
		}),
	};
});

describe("Sidebar (leftnav)", () => {
	const defaultProps = {
		setPage: vi.fn(),
		defaultSelectedKey: "api-keys",
		collapsed: false,
	};

	it("renders all top-level (non-nested) tabs for admin", () => {
		renderWithProviders(<Sidebar {...defaultProps} />);

		const topLevelLabels = [
			"Virtual Keys",
			"Playground",
			"Models + Endpoints",
			"MCP Servers",
			"Search Tools",
			"Usage",
			"Logs",
			"AI Hub",
			"API Playground",
			"Tag Management",
			"Claude Code Plugins",
			"Old Usage",
			"Router Settings",
			"Logging & Alerts",
			"Admin Settings",
			"Built-in Capabilities",
			"Cost Tracking",
		];

		topLevelLabels.forEach((label) => {
			expect(screen.getByText(label)).toBeInTheDocument();
		});
	});

	it("renders former Tools, Experimental, and Settings children as top-level items", () => {
		renderWithProviders(<Sidebar {...defaultProps} />);

		expect(screen.queryByText("Tools")).not.toBeInTheDocument();
		expect(screen.queryByText("Experimental")).not.toBeInTheDocument();
		expect(screen.queryByText("Settings")).not.toBeInTheDocument();
		expect(screen.getByText("Search Tools")).toBeInTheDocument();
		expect(screen.getByText("API Playground")).toBeInTheDocument();
		expect(screen.getByText("Admin Settings")).toBeInTheDocument();
		expect(screen.getByText("Built-in Capabilities")).toBeInTheDocument();
		expect(screen.queryByText("UI Theme")).not.toBeInTheDocument();

		const flatItems = menuGroups.flatMap((group) => group.items);
		expect(flatItems.every((item) => item.children === undefined)).toBe(true);
	});

	it("uses canonical sidebar hrefs that do not carry another page's URL state", () => {
		window.history.replaceState(
			{},
			"",
			"/ui/?page=logs&tab=aliases&key_alias=stale-alias&logs_page=4&logs_search=request",
		);

		renderWithProviders(<Sidebar {...defaultProps} />);

		expect(screen.getByRole("link", { name: "Virtual Keys" })).toHaveAttribute("href", "?page=api-keys");
		expect(screen.getByRole("link", { name: "Logs" })).toHaveAttribute("href", "?page=logs");
	});

	it("delegates navigation once to the parent without mutating the current URL itself", () => {
		const setPage = vi.fn();
		window.history.replaceState({}, "", "/ui/?page=logs&key_alias=stale-alias");
		renderWithProviders(<Sidebar {...defaultProps} setPage={setPage} />);

		fireEvent.click(screen.getByRole("link", { name: "Virtual Keys" }));

		expect(setPage).toHaveBeenCalledWith("api-keys");
		expect(window.location.search).toBe("?page=logs&key_alias=stale-alias");
	});

	it("has no duplicate keys among all menu items and their children", () => {
		// Helper to recursively extract all keys from Ant Design Menu items
		function getAllKeysFromMenu(wrapper: HTMLElement): string[] {
			const allKeys: string[] = [];
			// Ant Design renders key as data-menu-id or inside attributes, but for this case, we look for text as fallback.
			// For a generic check, here we fetch ids from rendered list items, and also descend into submenus
			const items = wrapper.querySelectorAll("[data-menu-id]");
			items.forEach((item) => {
				const dataMenuId = item.getAttribute("data-menu-id");
				if (dataMenuId) {
					allKeys.push(dataMenuId);
				}
			});
			return allKeys;
		}

		const { container } = renderWithProviders(<Sidebar {...defaultProps} />);
		const allRenderedKeys = getAllKeysFromMenu(container);

		const keySet = new Set<string>();
		const duplicates: string[] = [];
		for (const key of allRenderedKeys) {
			if (keySet.has(key)) {
				duplicates.push(key);
			}
			keySet.add(key);
		}
		expect(duplicates).toHaveLength(0);
	});

	it("should show Organizations tab for organization admins", async () => {
		mockUseAuthorized.mockReturnValueOnce({
			userId: "org-admin-user-id",
			accessToken: "test-access-token",
			userRole: "viewer",
			token: "test-token",
			userEmail: "orgadmin@example.com",
			premiumUser: false,
			disabledPersonalKeyCreation: false,
			showSSOBanner: false,
		});

		mockUseOrganizations.mockReturnValueOnce({
			data: [
				{
					organization_id: "org-1",
					organization_name: "Test Organization",
					spend: 0,
					max_budget: null,
					models: [],
					tpm_limit: null,
					rpm_limit: null,
					members: [
						{
							user_id: "org-admin-user-id",
							user_role: "org_admin",
						},
					],
				},
			],
			isLoading: false,
			error: null,
		} as any);

		renderWithProviders(<Sidebar {...defaultProps} />);
		fireEvent.click(screen.getByText("ACCESS CONTROL"));

		await waitFor(() => {
			expect(screen.getByText("Organizations")).toBeInTheDocument();
		});
	});
});
