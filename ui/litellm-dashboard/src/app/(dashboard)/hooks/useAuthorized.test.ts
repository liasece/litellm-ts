/* @vitest-environment jsdom */
import React from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import useAuthorized from "./useAuthorized";

vi.unmock("@/app/(dashboard)/hooks/useAuthorized");

const { replaceMock, getWebUiSessionMock, getProxyBaseUrlMock } = vi.hoisted(() => ({
	replaceMock: vi.fn(),
	getWebUiSessionMock: vi.fn(),
	getProxyBaseUrlMock: vi.fn(() => "http://proxy.example"),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: replaceMock }) }));
vi.mock("@/components/networking", () => ({
	getProxyBaseUrl: getProxyBaseUrlMock,
	getWebUiSession: getWebUiSessionMock,
}));
vi.mock("./uiConfig/useUIConfig", () => ({
	useUIConfig: () => ({ data: { admin_ui_disabled: false }, isLoading: false }),
}));
vi.mock("@/utils/returnUrlUtils", () => ({
	buildLoginUrlWithReturn: (url: string) => url,
	storeReturnUrl: vi.fn(),
}));

const wrapper = ({ children }: { children: React.ReactNode }) =>
	React.createElement(
		QueryClientProvider,
		{ client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
		children,
	);

describe("useAuthorized", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("从服务端 session 端点获取非敏感身份，不暴露 token 或 accessToken", async () => {
		getWebUiSessionMock.mockResolvedValue({
			authenticated: true,
			user_id: "default_user_id",
			user_email: "admin@example.com",
			user_role: "proxy_admin",
			login_method: "username_password",
			premium_user: true,
			disabled_non_admin_personal_key_creation: false,
			server_root_path: "/",
		});

		const { result } = renderHook(() => useAuthorized(), { wrapper });

		await waitFor(() => expect(result.current.isAuthorized).toBe(true));
		expect(result.current.userId).toBe("default_user_id");
		expect(result.current.userRole).toBe("Admin");
		expect(result.current.token).toBe("cookie-session");
		expect(result.current.accessToken).toBe("cookie-session");
		expect(document.cookie).not.toContain("token=");
		expect(replaceMock).not.toHaveBeenCalled();
	});

	it("session 查询失败时跳转登录页", async () => {
		getWebUiSessionMock.mockRejectedValue(new Error("unauthorized"));

		const { result } = renderHook(() => useAuthorized(), { wrapper });

		await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("http://proxy.example/ui/login"));
		expect(result.current.isAuthorized).toBe(false);
	});
});
