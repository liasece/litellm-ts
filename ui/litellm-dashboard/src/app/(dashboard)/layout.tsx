"use client";

import React, { Suspense } from "react";
import Navbar from "@/components/navbar";
import { ThemeProvider } from "@/contexts/ThemeContext";
import SidebarProvider from "@/app/(dashboard)/components/SidebarProvider";
import useAuthorized from "@/app/(dashboard)/hooks/useAuthorized";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { DebugWarningBanner } from "@/components/DebugWarningBanner";
import { deriveDashboardPage } from "@/app/(dashboard)/dashboardNavigation";

/** ---- BASE URL HELPERS ---- */
function normalizeBasePrefix(raw: string | undefined | null): string {
	const trimmed = (raw ?? "").trim();
	if (!trimmed) return "";
	const core = trimmed.replace(/^\/+/, "").replace(/\/+$/, "");
	return core ? `/${core}/` : "/";
}
const BASE_PREFIX = normalizeBasePrefix(process.env.NEXT_PUBLIC_BASE_URL);
function withBase(path: string): string {
	const body = path.startsWith("/") ? path.slice(1) : path;
	const combined = `${BASE_PREFIX}${body}`;
	return combined.startsWith("/") ? combined : `/${combined}`;
}
/** -------------------------------- */

/**
 * Pages that have been migrated to path-based routing under (dashboard)/.
 * When the leftnav triggers one of these, navigate to the path route instead
 * of the legacy query-param root page.
 *
 * Key = legacy page id used in leftnav, Value = route segment under (dashboard)/
 */
const MIGRATED_PAGES: Record<string, string> = {
	"api-reference": "api-reference",
};

function LayoutContent({ children }: { children: React.ReactNode }) {
	const router = useRouter();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const { accessToken, userRole, userId, userEmail, premiumUser } = useAuthorized();
	const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);
	const page = deriveDashboardPage(pathname, searchParams, BASE_PREFIX);

	const handleSetPage = (newPage: string) => {
		// If the page has been migrated to path routing, navigate there
		const migratedRoute = MIGRATED_PAGES[newPage];
		if (migratedRoute) {
			router.push(withBase(migratedRoute));
			return;
		}

		// Otherwise, navigate back to the legacy root page with query params
		router.push(withBase(`?page=${newPage}`));
	};

	const toggleSidebar = () => setSidebarCollapsed((v) => !v);

	return (
		<ThemeProvider accessToken={""}>
			<div data-testid="dashboard-shell" className="flex h-dvh min-h-0 flex-col overflow-hidden">
				<div className="shrink-0">
					<Navbar
						isPublicPage={false}
						sidebarCollapsed={sidebarCollapsed}
						onToggleSidebar={toggleSidebar}
						userID={userId}
						userEmail={userEmail}
						userRole={userRole}
						premiumUser={premiumUser}
						proxySettings={undefined}
						setProxySettings={() => {}}
						accessToken={accessToken}
						isDarkMode={false}
						toggleDarkMode={() => {}}
					/>
				</div>
				<div className="shrink-0">
					<DebugWarningBanner />
				</div>
				<div data-testid="dashboard-workspace" className="flex min-h-0 flex-1 overflow-hidden">
					<aside
						data-testid="dashboard-sidebar-scroll"
						className="min-h-0 shrink-0 overflow-x-hidden overflow-y-auto overscroll-contain pt-2"
					>
						<SidebarProvider setPage={handleSetPage} defaultSelectedKey={page} sidebarCollapsed={sidebarCollapsed} />
					</aside>
					<main data-testid="dashboard-main-scroll" className="min-w-0 flex-1 overflow-auto overscroll-contain">
						{children}
					</main>
				</div>
			</div>
		</ThemeProvider>
	);
}

export default function Layout({ children }: { children: React.ReactNode }) {
	return (
		<Suspense fallback={<div className="flex items-center justify-center min-h-screen">Loading...</div>}>
			<LayoutContent>{children}</LayoutContent>
		</Suspense>
	);
}
