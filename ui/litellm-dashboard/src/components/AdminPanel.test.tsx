import { render, screen } from "@testing-library/react";
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
	it("只保留 UI Settings tab", () => {
		render(<AdminPanel />);

		expect(screen.getByRole("tab", { name: "UI Settings" })).toBeInTheDocument();
		expect(screen.getByText("UI Settings Content")).toBeInTheDocument();
		expect(screen.queryByRole("tab", { name: "SSO Settings" })).not.toBeInTheDocument();
		expect(screen.queryByRole("tab", { name: "Security Settings" })).not.toBeInTheDocument();
		expect(screen.queryByRole("tab", { name: "SCIM" })).not.toBeInTheDocument();
		expect(screen.queryByRole("tab", { name: "Hashicorp Vault" })).not.toBeInTheDocument();
	});

	it("挂载时不触发隐藏模块的网络请求", () => {
		render(<AdminPanel />);

		expect(mockGetSSOSettings).not.toHaveBeenCalled();
		expect(mockGetAllowedIPs).not.toHaveBeenCalled();
	});
});
