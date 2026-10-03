import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AdminPanel from "./AdminPanel";

const mockGetSSOSettings = vi.fn();
const mockGetAllowedIPs = vi.fn();

vi.mock("./networking", () => ({
	getSSOSettings: (...args: unknown[]) => mockGetSSOSettings(...args),
	getAllowedIPs: (...args: unknown[]) => mockGetAllowedIPs(...args),
}));

vi.mock("./Settings/AdminSettings/UISettings/UISettings", () => ({
	default: () => <div>UI Settings Content</div>,
}));

vi.mock("@/app/(dashboard)/hooks/useAuthorized", () => ({
	default: () => ({
		premiumUser: true,
		accessToken: "test-token",
		userId: "user-1",
	}),
}));

describe("AdminPanel", () => {
	it("提供 UI Settings 和价格显示设置", () => {
		render(
			<QueryClientProvider client={new QueryClient()}>
				<AdminPanel />
			</QueryClientProvider>,
		);

		expect(screen.getByRole("tab", { name: "UI Settings" })).toBeInTheDocument();
		expect(screen.getByText("UI Settings Content")).toBeInTheDocument();
		fireEvent.click(screen.getByRole("tab", { name: "价格显示" }));
		expect(screen.getByText("全局显示币种")).toBeInTheDocument();
		expect(screen.getByLabelText("汇率数据源")).toBeInTheDocument();
		expect(screen.queryByRole("tab", { name: "SSO Settings" })).not.toBeInTheDocument();
		expect(screen.queryByRole("tab", { name: "Security Settings" })).not.toBeInTheDocument();
		expect(screen.queryByRole("tab", { name: "SCIM" })).not.toBeInTheDocument();
		expect(screen.queryByRole("tab", { name: "Hashicorp Vault" })).not.toBeInTheDocument();
	});

	it("挂载时不触发隐藏模块的网络请求", () => {
		render(
			<QueryClientProvider client={new QueryClient()}>
				<AdminPanel />
			</QueryClientProvider>,
		);

		expect(mockGetSSOSettings).not.toHaveBeenCalled();
		expect(mockGetAllowedIPs).not.toHaveBeenCalled();
	});
});
