import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import Layout from "./layout";

vi.mock("next/navigation", () => ({
	usePathname: () => "/",
	useRouter: () => ({ push: vi.fn() }),
	useSearchParams: () => new URLSearchParams("page=logs"),
}));

vi.mock("@/app/(dashboard)/hooks/useAuthorized", () => ({
	default: () => ({
		accessToken: "test-token",
		userRole: "Admin",
		userId: "user-1",
		userEmail: "user@example.com",
		premiumUser: false,
	}),
}));

vi.mock("@/contexts/ThemeContext", () => ({
	ThemeProvider: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/components/navbar", () => ({
	default: ({ onToggleMobileSidebar }: { onToggleMobileSidebar: () => void }) => (
		<header data-testid="navbar">
			<button type="button" data-testid="mobile-nav-toggle" onClick={onToggleMobileSidebar}>
				Menu
			</button>
		</header>
	),
}));

vi.mock("@/components/DebugWarningBanner", () => ({
	DebugWarningBanner: () => <div data-testid="debug-banner">Debug</div>,
}));

vi.mock("@/app/(dashboard)/components/SidebarProvider", () => ({
	default: () => <nav data-testid="sidebar">Sidebar</nav>,
}));

vi.mock("@/app/(dashboard)/dashboardNavigation", () => ({
	deriveDashboardPage: () => "logs",
}));

describe("Dashboard layout", () => {
	it("keeps the viewport fixed and gives the sidebar and main content independent scroll containers", () => {
		render(
			<Layout>
				<div>Main content</div>
			</Layout>,
		);

		expect(screen.getByTestId("dashboard-shell")).toHaveClass("h-dvh", "overflow-hidden");
		expect(screen.getByTestId("dashboard-workspace")).toHaveClass("min-h-0", "flex-1", "overflow-hidden");
		expect(screen.getByTestId("dashboard-sidebar-scroll")).toHaveClass(
			"overflow-y-auto",
			"overflow-x-hidden",
			"overscroll-contain",
		);
		expect(screen.getByTestId("dashboard-main-scroll")).toHaveClass(
			"min-w-0",
			"flex-1",
			"overflow-auto",
			"overscroll-contain",
		);
	});

	it("opens the mobile navigation as an overlay and dismisses it from the backdrop", () => {
		render(
			<Layout>
				<div>Main content</div>
			</Layout>,
		);

		const sidebar = screen.getByTestId("dashboard-sidebar-scroll");
		expect(sidebar).toHaveClass("invisible", "-translate-x-full");

		fireEvent.click(screen.getByTestId("mobile-nav-toggle"));
		expect(sidebar).toHaveClass("visible", "translate-x-0");

		fireEvent.click(screen.getByRole("button", { name: "Dismiss navigation overlay" }));
		expect(sidebar).toHaveClass("invisible", "-translate-x-full");
	});
});
