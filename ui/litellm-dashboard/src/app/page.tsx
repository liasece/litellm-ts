"use client";

import SidebarProvider from "@/app/(dashboard)/components/SidebarProvider";
import { buildLegacyDashboardHref } from "@/app/(dashboard)/dashboardNavigation";
import LegacyDashboardPageContent from "@/app/(dashboard)/components/LegacyDashboardPageContent";
import { teamListCall as v2TeamListCall } from "@/app/(dashboard)/hooks/teams/useTeams";
import LoadingScreen from "@/components/common_components/LoadingScreen";
import { Team } from "@/components/key_team_helpers/key_list";
import Navbar from "@/components/navbar";
import {
	getUiConfig,
	getWebUiSession,
	Organization,
	proxyBaseUrl,
	getInProductNudgesCall,
	getYamlConfigDiffCall,
	acceptYamlConfigDiffCall,
	resolveYamlConfigDiffCall,
	YamlConfigDiffItem,
} from "@/components/networking";
import { fetchUserModels, CreateKeyPrefillData } from "@/components/organisms/create_key_button";
import { fetchOrganizations } from "@/components/organizations";
import { ClaudeCodePrompt, ClaudeCodeModal } from "@/components/survey";
import UserDashboard from "@/components/user_dashboard";
import YamlConfigDiffModal from "@/components/YamlConfigDiffModal";
import { ThemeProvider } from "@/contexts/ThemeContext";
import {
	buildLoginUrlWithReturn,
	consumeReturnUrl,
	normalizeUrlForCompare,
	storeReturnUrl,
} from "@/utils/returnUrlUtils";
import { formatUserRole, isProxyAdminRole } from "@/utils/roles";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { ConfigProvider, theme } from "antd";

const COOKIE_SESSION_CREDENTIAL = "cookie-session";

interface ProxySettings {
	PROXY_BASE_URL: string;
	PROXY_LOGOUT_URL: string;
	LITELLM_UI_API_DOC_BASE_URL?: string | null;
}

/**
 * Map of legacy query-param page keys → new path-based route segments.
 * When a user visits ?page=<key>, they are redirected to /ui/<value>.
 * Add entries here as pages are migrated from the if/else chain to path-based routes.
 */
const LEGACY_REDIRECTS: Record<string, string> = {
	api_ref: "api-reference",
	"api-reference": "api-reference",
	"builtin-capabilities": "builtin-capabilities",
};

function CreateKeyPageContent() {
	const [userRole, setUserRole] = useState("");
	const [premiumUser, setPremiumUser] = useState(false);
	const [disabledPersonalKeyCreation, setDisabledPersonalKeyCreation] = useState(false);
	const [userEmail, setUserEmail] = useState<null | string>(null);
	const [teams, setTeams] = useState<Team[] | null>(null);
	const [keys, setKeys] = useState<null | any[]>([]);
	const [organizations, setOrganizations] = useState<Organization[]>([]);
	const [userModels, setUserModels] = useState<string[]>([]);
	const [proxySettings, setProxySettings] = useState<ProxySettings>({
		PROXY_BASE_URL: "",
		PROXY_LOGOUT_URL: "",
	});

	const [showSSOBanner, setShowSSOBanner] = useState<boolean>(true);
	const router = useRouter();
	const searchParams = useSearchParams()!;
	const [modelData, setModelData] = useState<any>({ data: [] });
	const [token, setToken] = useState<string | null>(null);
	const [createClicked, setCreateClicked] = useState<boolean>(false);
	const [authLoading, setAuthLoading] = useState(true);
	const [userID, setUserID] = useState<string | null>(null);

	// Claude Code feedback state
	const [showClaudeCodePrompt, setShowClaudeCodePrompt] = useState(false);
	const [showClaudeCodeModal, setShowClaudeCodeModal] = useState(false);

	// yaml 差异对比导入窗口状态（批次 E4）
	const [yamlDiffItems, setYamlDiffItems] = useState<YamlConfigDiffItem[]>([]);
	const [showYamlDiffModal, setShowYamlDiffModal] = useState(false);

	// Dark mode state
	const [isDarkMode, setIsDarkMode] = useState(false);
	const toggleDarkMode = () => {
		setIsDarkMode(!isDarkMode);
	};

	const invitation_id = searchParams.get("invitation_id");

	// Parse URL query parameters for pre-filling the create key form
	// Includes validation to prevent injection and DoS attacks
	const autoOpenCreate = searchParams.get("create") === "true";
	const prefillData: CreateKeyPrefillData | undefined = useMemo(() => {
		if (!autoOpenCreate) return undefined;

		const ownedBy = searchParams.get("owned_by");
		const teamId = searchParams.get("team_id");
		const keyAlias = searchParams.get("key_alias");
		const modelsParam = searchParams.get("models");
		const keyType = searchParams.get("key_type");

		// Only return prefill data if at least one field is provided
		if (!ownedBy && !teamId && !keyAlias && !modelsParam && !keyType) {
			return undefined;
		}

		// Validate owned_by against allowed values
		const validOwnedByValues = ["you", "service_account", "another_user"];
		const validatedOwnedBy =
			ownedBy && validOwnedByValues.includes(ownedBy) ? (ownedBy as CreateKeyPrefillData["owned_by"]) : undefined;

		// Validate key_type against allowed values
		const validKeyTypes = ["default", "llm_api", "management"];
		const validatedKeyType =
			keyType && validKeyTypes.includes(keyType) ? (keyType as CreateKeyPrefillData["key_type"]) : undefined;

		// Sanitize key_alias (limit length, trim whitespace)
		const sanitizedKeyAlias = keyAlias
			? keyAlias.trim().slice(0, 256) // Reasonable max length
			: undefined;

		// Sanitize models (limit array size and individual model name length)
		const sanitizedModels = modelsParam
			? modelsParam
					.split(",")
					.slice(0, 100) // Limit number of models to prevent DoS
					.map((m) => m.trim().slice(0, 256)) // Limit individual model name length
					.filter((m) => m.length > 0) // Remove empty strings
			: undefined;

		return {
			owned_by: validatedOwnedBy,
			team_id: teamId?.trim() || undefined,
			key_alias: sanitizedKeyAlias,
			models: sanitizedModels && sanitizedModels.length > 0 ? sanitizedModels : undefined,
			key_type: validatedKeyType,
		};
	}, [searchParams, autoOpenCreate]);

	// Get page from URL, default to 'api-keys' if not present
	const [page, setPage] = useState(() => {
		return searchParams.get("page") || "api-keys";
	});

	// Custom setPage function that updates URL
	const updatePage = (newPage: string) => {
		setMobileSidebarOpen(false);
		window.history.pushState(null, "", buildLegacyDashboardHref(newPage));
		setPage(newPage);
	};

	const [accessToken, setAccessToken] = useState<string | null>(null);
	const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
	const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

	// Track if we've already attempted a return URL redirect to prevent race conditions
	const hasAttemptedReturnRedirectRef = useRef(false);

	const toggleSidebar = () => {
		setSidebarCollapsed(!sidebarCollapsed);
	};

	useEffect(() => {
		if (!mobileSidebarOpen) return;

		const closeOnEscape = (event: KeyboardEvent) => {
			if (event.key === "Escape") setMobileSidebarOpen(false);
		};
		window.addEventListener("keydown", closeOnEscape);
		return () => window.removeEventListener("keydown", closeOnEscape);
	}, [mobileSidebarOpen]);

	const addKey = (data: any) => {
		setKeys((prevData) => (prevData ? [...prevData, data] : [data]));
		setCreateClicked(() => !createClicked);
	};
	const redirectToLogin = authLoading === false && token === null && invitation_id === null;

	useEffect(() => {
		let cancelled = false;

		(async () => {
			try {
				await getUiConfig();
				const session = await getWebUiSession();
				if (cancelled) return;

				setToken(COOKIE_SESSION_CREDENTIAL);
				setAccessToken(COOKIE_SESSION_CREDENTIAL);
				setDisabledPersonalKeyCreation(session.disabled_non_admin_personal_key_creation);
				const formattedUserRole = formatUserRole(session.user_role);
				setUserRole(formattedUserRole);
				if (formattedUserRole === "Admin Viewer") setPage("usage");
				setUserEmail(session.user_email);
				setShowSSOBanner(session.login_method === "username_password");
				setPremiumUser(session.premium_user);
				setUserID(session.user_id);
			} catch {
				if (!cancelled) {
					setToken(null);
					setAccessToken(null);
				}
			} finally {
				if (!cancelled) setAuthLoading(false);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => {
		if (redirectToLogin) {
			storeReturnUrl();
			const baseLoginUrl = (proxyBaseUrl || "") + "/ui/login";
			window.location.replace(buildLoginUrlWithReturn(baseLoginUrl));
		}
	}, [redirectToLogin]);

	const isLegacyRedirect = page in LEGACY_REDIRECTS;
	useEffect(() => {
		if (!authLoading && isLegacyRedirect) {
			const base = (proxyBaseUrl || "") + "/ui";
			router.replace(`${base}/${LEGACY_REDIRECTS[page]}`);
		}
	}, [authLoading, isLegacyRedirect, page, router]);

	useEffect(() => {
		if (authLoading || !token || hasAttemptedReturnRedirectRef.current) return;
		hasAttemptedReturnRedirectRef.current = true;
		const returnUrl = consumeReturnUrl();
		if (returnUrl && normalizeUrlForCompare(returnUrl) !== normalizeUrlForCompare(window.location.href)) {
			window.location.replace(returnUrl);
		}
	}, [authLoading, token]);

	useEffect(() => {
		if (!token) hasAttemptedReturnRedirectRef.current = false;
	}, [token]);

	useEffect(() => {
		if (accessToken && userID && userRole) {
			fetchUserModels(userID, userRole, accessToken, setUserModels);
		}
		if (accessToken && userID && userRole) {
			v2TeamListCall(accessToken, 1, 100, {
				userID: userRole !== "Admin" && userRole !== "Admin Viewer" ? userID : null,
			})
				.then((response) => setTeams(response.teams ?? []))
				.catch(console.error);
		}
		if (accessToken) {
			fetchOrganizations(accessToken, setOrganizations);
		}
	}, [accessToken, userID, userRole]);

	// Fetch in-product nudges configuration from backend
	useEffect(() => {
		if (accessToken && token) {
			(async () => {
				try {
					const nudgesConfig = await getInProductNudgesCall(accessToken);
					const isUsingClaudeCode = nudgesConfig?.is_claude_code_enabled || false;
					// Show Claude Code prompt on login if enabled
					if (isUsingClaudeCode) {
						setShowClaudeCodePrompt(true);
					}
				} catch (error) {
					console.error("Failed to fetch in-product nudges:", error);
					// Silently fail and don't show Claude Code nudge
				}
			})();
		}
	}, [accessToken, token]);

	// Fetch yaml ↔ DB 配置差异（仅 proxy_admin；有 pending 时弹差异对比导入窗口）
	useEffect(() => {
		if (accessToken && isProxyAdminRole(userRole)) {
			(async () => {
				try {
					const diff = await getYamlConfigDiffCall(accessToken);
					if (diff.has_pending && diff.items.length > 0) {
						setYamlDiffItems(diff.items);
						setShowYamlDiffModal(true);
					}
				} catch (error) {
					console.error("Failed to fetch yaml config diff:", error);
					// Silently fail and don't show the diff modal
				}
			})();
		}
	}, [accessToken, userRole]);

	// Auto-dismiss Claude Code prompt after 15 seconds
	useEffect(() => {
		if (showClaudeCodePrompt && !showClaudeCodeModal) {
			const timer = setTimeout(() => {
				setShowClaudeCodePrompt(false);
			}, 15000);
			return () => clearTimeout(timer);
		}
	}, [showClaudeCodePrompt, showClaudeCodeModal]);

	const handleOpenClaudeCode = () => {
		setShowClaudeCodePrompt(false);
		setShowClaudeCodeModal(true);
	};

	const handleDismissClaudeCodePrompt = () => {
		setShowClaudeCodePrompt(false);
	};

	const handleClaudeCodeComplete = () => {
		setShowClaudeCodeModal(false);
	};

	const handleClaudeCodeModalClose = () => {
		// If they close the modal without completing, show the prompt again
		setShowClaudeCodeModal(false);
		setShowClaudeCodePrompt(true);
	};

	// yaml 差异对比导入窗口：接受某项差异（yaml 值覆盖 DB），从列表移除
	const handleYamlDiffAccept = async (section: string, key: string) => {
		if (!accessToken) return;
		await acceptYamlConfigDiffCall(accessToken, section, key);
		setYamlDiffItems((prev) => prev.filter((item) => !(item.section === section && item.key === key)));
	};

	// yaml 差异对比导入窗口：「处理冲突完成」存快照并关闭
	const handleYamlDiffResolve = async () => {
		if (!accessToken) return;
		await resolveYamlConfigDiffCall(accessToken);
		setYamlDiffItems([]);
		setShowYamlDiffModal(false);
	};

	if (authLoading || redirectToLogin || isLegacyRedirect) {
		return <LoadingScreen />;
	}

	return (
		<Suspense fallback={<LoadingScreen />}>
			<ConfigProvider
				theme={{
					algorithm: isDarkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
				}}
			>
				<ThemeProvider accessToken={accessToken}>
					{invitation_id ? (
						<UserDashboard
							userID={userID}
							userRole={userRole}
							premiumUser={premiumUser}
							teams={teams}
							keys={keys}
							setUserRole={setUserRole}
							userEmail={userEmail}
							setUserEmail={setUserEmail}
							setTeams={setTeams}
							setKeys={setKeys}
							organizations={organizations}
							addKey={addKey}
							createClicked={createClicked}
						/>
					) : (
						<div data-testid="dashboard-shell" className="flex h-dvh min-h-0 flex-col overflow-hidden">
							<div className="shrink-0">
								<Navbar
									userID={userID}
									userRole={userRole}
									premiumUser={premiumUser}
									userEmail={userEmail}
									setProxySettings={setProxySettings}
									proxySettings={proxySettings}
									accessToken={accessToken}
									isPublicPage={false}
									sidebarCollapsed={sidebarCollapsed}
									onToggleSidebar={toggleSidebar}
									mobileSidebarOpen={mobileSidebarOpen}
									onToggleMobileSidebar={() => setMobileSidebarOpen((open) => !open)}
									isDarkMode={isDarkMode}
									toggleDarkMode={toggleDarkMode}
								/>
							</div>
							<div data-testid="dashboard-workspace" className="relative flex min-h-0 flex-1 overflow-hidden">
								{mobileSidebarOpen && (
									<button
										type="button"
										className="absolute inset-0 z-20 bg-slate-950/35 md:hidden"
										onClick={() => setMobileSidebarOpen(false)}
										aria-label="Dismiss navigation overlay"
										tabIndex={-1}
									/>
								)}
								<aside
									id="dashboard-mobile-navigation"
									data-testid="dashboard-sidebar-scroll"
									aria-label="Dashboard navigation"
									className={`absolute inset-y-0 left-0 z-30 min-h-0 shrink-0 overflow-x-hidden overflow-y-auto overscroll-contain bg-white pt-2 shadow-xl transition-[transform,visibility] duration-200 md:relative md:inset-auto md:z-auto md:translate-x-0 md:visible md:shadow-none ${
										mobileSidebarOpen ? "visible translate-x-0" : "invisible -translate-x-full"
									}`}
								>
									<SidebarProvider setPage={updatePage} defaultSelectedKey={page} sidebarCollapsed={sidebarCollapsed} />
								</aside>
								<main
									data-testid="dashboard-main-scroll"
									className="dashboard-main-scroll min-w-0 flex-1 overflow-auto overscroll-contain"
								>
									<LegacyDashboardPageContent
										page={page}
										userID={userID}
										userRole={userRole}
										premiumUser={premiumUser}
										teams={teams}
										keys={keys}
										setUserRole={setUserRole}
										userEmail={userEmail}
										setUserEmail={setUserEmail}
										setTeams={setTeams}
										setKeys={setKeys}
										organizations={organizations}
										setOrganizations={setOrganizations}
										addKey={addKey}
										createClicked={createClicked}
										autoOpenCreate={autoOpenCreate}
										prefillData={prefillData}
										token={token}
										modelData={modelData}
										setModelData={setModelData}
										accessToken={accessToken}
										proxySettings={proxySettings}
										userModels={userModels}
									/>
								</main>
							</div>

							{/* Claude Code Components */}
							<ClaudeCodePrompt
								isVisible={showClaudeCodePrompt}
								onOpen={handleOpenClaudeCode}
								onDismiss={handleDismissClaudeCodePrompt}
							/>
							<ClaudeCodeModal
								isOpen={showClaudeCodeModal}
								onClose={handleClaudeCodeModalClose}
								onComplete={handleClaudeCodeComplete}
							/>

							{/* yaml 差异对比导入窗口（仅 proxy_admin 有 pending 时展示） */}
							<YamlConfigDiffModal
								isOpen={showYamlDiffModal}
								items={yamlDiffItems}
								onAccept={handleYamlDiffAccept}
								onResolve={handleYamlDiffResolve}
								onClose={() => setShowYamlDiffModal(false)}
							/>
						</div>
					)}
				</ThemeProvider>
			</ConfigProvider>
		</Suspense>
	);
}

export default function CreateKeyPage() {
	return (
		<Suspense fallback={<LoadingScreen />}>
			<CreateKeyPageContent />
		</Suspense>
	);
}
