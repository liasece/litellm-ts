/* @vitest-environment jsdom */
import React from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import useAuthorized from "./useAuthorized";

vi.unmock("@/app/(dashboard)/hooks/useAuthorized");

const { replaceMock, getWebUiSessionMock, getProxyBaseUrlMock, keepAliveListeners, unsubscribeKeepAliveMock } = vi.hoisted(() => {
	const listeners: Array<() => void> = [];
	return {
		replaceMock: vi.fn(),
		getWebUiSessionMock: vi.fn(),
		getProxyBaseUrlMock: vi.fn(() => "http://proxy.example"),
		keepAliveListeners: listeners,
		unsubscribeKeepAliveMock: vi.fn(),
	};
});

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: replaceMock }) }));
vi.mock("@/components/networking", () => ({
	getProxyBaseUrl: getProxyBaseUrlMock,
	getWebUiSession: getWebUiSessionMock,
	// hook 订阅 session 过期广播；返回的取消函数用于组件卸载时解绑。
	subscribeToWebUiSessionKeepAlive: (onExpired: () => void) => {
		keepAliveListeners.push(onExpired);
		return () => {
			unsubscribeKeepAliveMock();
			const index = keepAliveListeners.indexOf(onExpired);
			if (index >= 0) {
				keepAliveListeners.splice(index, 1);
			}
		};
	},
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
		keepAliveListeners.length = 0;
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

	it("session 过期广播到达时撤销本地身份并跳转登录页", async () => {
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
		expect(keepAliveListeners).toHaveLength(1);

		// 后端判定 cookie session 已失效时，hook 必须把本地身份清空并回到登录页。
		act(() => {
			keepAliveListeners.forEach((notify) => notify());
		});

		await waitFor(() => expect(result.current.isAuthorized).toBe(false));
		expect(replaceMock).toHaveBeenCalledWith("http://proxy.example/ui/login");
	});

	it("卸载时取消 session 过期订阅", async () => {
		getWebUiSessionMock.mockResolvedValue({ authenticated: true });
		const { unmount } = renderHook(() => useAuthorized(), { wrapper });
		await waitFor(() => expect(keepAliveListeners).toHaveLength(1));

		unmount();
		expect(unsubscribeKeepAliveMock).toHaveBeenCalled();
		expect(keepAliveListeners).toHaveLength(0);
	});

	it("session 查询失败时跳转登录页", async () => {
		getWebUiSessionMock.mockRejectedValue(new Error("unauthorized"));

		const { result } = renderHook(() => useAuthorized(), { wrapper });

		await waitFor(() => expect(replaceMock).toHaveBeenCalledWith("http://proxy.example/ui/login"));
		expect(result.current.isAuthorized).toBe(false);
	});
});
