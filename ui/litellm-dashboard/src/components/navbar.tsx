import { getProxyBaseUrl, logoutWebUiSession } from "@/components/networking";
import { useTheme } from "@/contexts/ThemeContext";
import { clearStoredReturnUrl } from "@/utils/returnUrlUtils";
import { fetchProxySettings } from "@/utils/proxyUtils";
import { MenuFoldOutlined, MenuUnfoldOutlined, MoonOutlined, SunOutlined } from "@ant-design/icons";
import { Button, Switch } from "antd";
import Link from "next/link";
import React, { useEffect, useState } from "react";
import UserDropdown from "./Navbar/UserDropdown/UserDropdown";
import WorkerDropdown from "./Navbar/WorkerDropdown/WorkerDropdown";

interface NavbarProps {
	userID: string | null;
	userEmail: string | null;
	userRole: string | null;
	premiumUser: boolean;
	proxySettings: any;
	setProxySettings: React.Dispatch<React.SetStateAction<any>>;
	accessToken: string | null;
	isPublicPage: boolean;
	sidebarCollapsed?: boolean;
	onToggleSidebar?: () => void;
	mobileSidebarOpen?: boolean;
	onToggleMobileSidebar?: () => void;
	isDarkMode: boolean;
	toggleDarkMode: () => void;
}

const Navbar: React.FC<NavbarProps> = ({
	userID,
	userEmail,
	userRole,
	premiumUser,
	proxySettings,
	setProxySettings,
	accessToken,
	isPublicPage = false,
	sidebarCollapsed = false,
	onToggleSidebar,
	mobileSidebarOpen = false,
	onToggleMobileSidebar,
	isDarkMode,
	toggleDarkMode,
}) => {
	const baseUrl = getProxyBaseUrl();
	const [logoutUrl, setLogoutUrl] = useState("");
	const { logoUrl } = useTheme();

	// Simple logo URL: use custom logo if available, otherwise default
	const imageUrl = logoUrl || `${baseUrl}/get_image`;
	const fallbackImageUrl = `${baseUrl}/get_image`;

	useEffect(() => {
		const initializeProxySettings = async () => {
			if (accessToken) {
				const settings = await fetchProxySettings(accessToken);
				console.log("response from fetchProxySettings", settings);
				if (settings) {
					setProxySettings(settings);
				}
			}
		};

		initializeProxySettings();
	}, [accessToken, setProxySettings]);

	useEffect(() => {
		setLogoutUrl(proxySettings?.PROXY_LOGOUT_URL || "");
	}, [proxySettings]);

	const handleLogout = async () => {
		await logoutWebUiSession();
		localStorage.removeItem("litellm_selected_worker_id");
		localStorage.removeItem("litellm_worker_url");
		window.location.href = logoutUrl || "/ui/login";
	};

	const handleWorkerSwitch = async (workerId: string) => {
		await logoutWebUiSession().catch(() => undefined);
		clearStoredReturnUrl();
		localStorage.removeItem("litellm_selected_worker_id");
		localStorage.removeItem("litellm_worker_url");
		window.location.href = `/ui/login?worker=${encodeURIComponent(workerId)}`;
	};

	return (
		<nav className="bg-white border-b border-gray-200 sticky top-0 z-10">
			<div className="w-full">
				<div className="flex h-14 min-w-0 items-center px-2 sm:px-4">
					<div className="flex min-w-0 items-center flex-shrink-0">
						{onToggleMobileSidebar && (
							<button
								type="button"
								onClick={onToggleMobileSidebar}
								className="mr-1 flex h-11 w-11 items-center justify-center rounded text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 md:hidden"
								title={mobileSidebarOpen ? "Close navigation" : "Open navigation"}
								aria-label={mobileSidebarOpen ? "Close navigation" : "Open navigation"}
								aria-expanded={mobileSidebarOpen}
								aria-controls="dashboard-mobile-navigation"
							>
								<span className="text-lg">{mobileSidebarOpen ? <MenuFoldOutlined /> : <MenuUnfoldOutlined />}</span>
							</button>
						)}
						{onToggleSidebar && (
							<button
								type="button"
								onClick={onToggleSidebar}
								className="mr-2 hidden h-10 w-10 items-center justify-center rounded text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 md:flex"
								title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
								aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
							>
								<span className="text-lg">{sidebarCollapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}</span>
							</button>
						)}

						<div className="flex min-w-0 items-center gap-2">
							<Link href={baseUrl ? baseUrl : "/"} className="flex min-w-0 items-center">
								<div className="relative">
									<div className="flex h-9 max-w-28 items-center justify-center overflow-hidden sm:h-10 sm:max-w-48">
										<img
											src={imageUrl}
											alt="LiteLLM Brand"
											className="max-w-full max-h-full w-auto h-auto object-contain"
											onError={(event) => {
												if (event.currentTarget.getAttribute("src") !== fallbackImageUrl) {
													event.currentTarget.src = fallbackImageUrl;
												}
											}}
										/>
									</div>
								</div>
							</Link>
						</div>
					</div>
					{/* Right side nav items */}
					<div className="ml-auto flex min-w-0 items-center gap-1 sm:gap-3 lg:gap-5">
						<div className="min-w-0">
							<WorkerDropdown onWorkerSwitch={handleWorkerSwitch} />
						</div>
						{/* Dark mode is currently a work in progress. To test, you can change 'false' to 'true' below.
            Do not set this to true by default until all components are confirmed to support dark mode styles. */}
						{false && (
							<Switch
								data-testid="dark-mode-toggle"
								checked={isDarkMode}
								onChange={toggleDarkMode}
								checkedChildren={<MoonOutlined />}
								unCheckedChildren={<SunOutlined />}
							/>
						)}
						<span className="hidden sm:inline-flex">
							<Button type="text" href="https://docs.litellm.ai/docs/" target="_blank" rel="noopener noreferrer">
								Docs
							</Button>
						</span>

						{!isPublicPage && <UserDropdown onLogout={handleLogout} />}
					</div>
				</div>
			</div>
		</nav>
	);
};

export default Navbar;
