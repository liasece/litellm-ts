"use client";

import { getProxyBaseUrl, getWebUiSession, type WebUiSessionInfo } from "@/components/networking";
import { buildLoginUrlWithReturn, storeReturnUrl } from "@/utils/returnUrlUtils";
import { formatUserRole } from "@/utils/roles";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useUIConfig } from "./uiConfig/useUIConfig";

/** 通过后端 HttpOnly cookie session 判断 Dashboard 身份。 */
const useAuthorized = () => {
	const router = useRouter();
	const { data: uiConfig, isLoading: isUIConfigLoading } = useUIConfig();
	const [session, setSession] = useState<WebUiSessionInfo | null>(null);
	const [isSessionLoading, setIsSessionLoading] = useState(true);

	const redirectToLogin = useCallback(() => {
		storeReturnUrl();
		const baseLoginUrl = `${getProxyBaseUrl()}/ui/login`;
		router.replace(buildLoginUrlWithReturn(baseLoginUrl));
	}, [router]);

	useEffect(() => {
		let active = true;
		void getWebUiSession()
			.then((response) => {
				if (active) setSession(response);
			})
			.catch(() => {
				if (active) setSession(null);
			})
			.finally(() => {
				if (active) setIsSessionLoading(false);
			});
		return () => {
			active = false;
		};
	}, []);

	const isLoading = isUIConfigLoading || isSessionLoading;
	const isAuthorized = session !== null && !uiConfig?.admin_ui_disabled;

	useEffect(() => {
		if (!isLoading && !isAuthorized) {
			redirectToLogin();
		}
	}, [isLoading, isAuthorized, redirectToLogin]);

	return {
		isLoading: isLoading,
		isAuthorized: isAuthorized,
		// 保留现有组件的 truthy 门禁；该固定标记不是密钥，networking 不会把它写入 header。
		token: isAuthorized ? "cookie-session" : null,
		accessToken: isAuthorized ? "cookie-session" : "",
		userId: session?.user_id ?? "",
		userEmail: session?.user_email ?? "",
		userRole: session ? formatUserRole(session.user_role) : "",
		premiumUser: session?.premium_user ?? false,
		disabledPersonalKeyCreation: session?.disabled_non_admin_personal_key_creation ?? false,
		showSSOBanner: session?.login_method === "username_password",
	};
};

export default useAuthorized;
