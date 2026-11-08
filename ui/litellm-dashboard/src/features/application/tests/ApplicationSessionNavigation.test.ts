import { describe, expect, it, vi } from "vitest";
import { createSessionNavigation } from "../logic/ApplicationSessionNavigationLogic";
function fixture() {
	let settings: Record<string, unknown> = { PROXY_LOGOUT_URL: "https://identity.example.test/signed-out" };
	const actions: string[] = [],
		navigate = vi.fn((url: string) => actions.push("navigate:" + url));
	const dependencies = {
		logout: vi.fn(async () => {
			actions.push("logout");
			settings = {};
		}),
		disconnectWorker: vi.fn(() => actions.push("disconnect")),
		clearReturnUrl: vi.fn(() => actions.push("clearReturn")),
		navigate,
		logoutUrl: () => settings.PROXY_LOGOUT_URL,
		uiBase: () => "/tenant/ui",
	};
	return { dependencies, actions, navigate, navigation: createSessionNavigation(dependencies) };
}
describe("session navigation", () => {
	it("keeps the configured logout destination when session cleanup clears application settings", async () => {
		const f = fixture();
		await f.navigation.logout();
		expect(f.actions).toEqual(["logout", "disconnect", "navigate:https://identity.example.test/signed-out"]);
	});
	it("does not clear worker state or navigate when logout fails", async () => {
		const f = fixture();
		f.dependencies.logout.mockRejectedValueOnce(new Error("offline"));
		await expect(f.navigation.logout()).rejects.toThrow("offline");
		expect(f.dependencies.disconnectWorker).not.toHaveBeenCalled();
		expect(f.navigate).not.toHaveBeenCalled();
	});
	it("clears the previous worker and return URL before switching even if old session logout fails", async () => {
		const f = fixture();
		f.dependencies.logout.mockRejectedValueOnce(new Error("offline"));
		await f.navigation.switchWorker("worker / β");
		expect(f.actions).toEqual(["clearReturn", "disconnect", "navigate:/tenant/ui/login?worker=worker%20%2F%20%CE%B2"]);
	});
	it("uses the installation prefix when no custom logout URL is configured", async () => {
		const f = fixture();
		f.dependencies.logoutUrl = () => undefined;
		await f.navigation.logout();
		expect(f.navigate).toHaveBeenCalledWith("/tenant/ui/login");
	});
});
