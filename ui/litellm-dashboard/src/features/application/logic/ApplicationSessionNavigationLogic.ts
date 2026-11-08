export interface SessionNavigationDependencies {
	logout: () => Promise<void>;
	disconnectWorker: () => void;
	clearReturnUrl: () => void;
	navigate: (url: string) => void;
	logoutUrl: () => unknown;
	uiBase: () => string;
}

export function createSessionNavigation(dependencies: SessionNavigationDependencies) {
	async function logout(): Promise<void> {
		const configured = dependencies.logoutUrl();
		const destination = typeof configured === "string" && configured ? configured : dependencies.uiBase() + "/login";
		await dependencies.logout();
		dependencies.disconnectWorker();
		dependencies.navigate(destination);
	}
	async function switchWorker(worker: string): Promise<void> {
		await dependencies.logout().catch(() => undefined);
		dependencies.clearReturnUrl();
		dependencies.disconnectWorker();
		dependencies.navigate(dependencies.uiBase() + "/login?worker=" + encodeURIComponent(worker));
	}
	return { logout, switchWorker };
}
