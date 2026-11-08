export function completeMcpOAuthCallback(
	currentLocation: Pick<Location, "pathname" | "search" | "replace"> = window.location,
	storage: Pick<Storage, "getItem" | "setItem"> = window.sessionStorage,
): void {
	const params = new URLSearchParams(currentLocation.search);
	const payload = {
		type: "litellm-mcp-oauth",
		code: params.get("code"),
		state: params.get("state"),
		error: params.get("error"),
		error_description: params.get("error_description"),
	};
	try {
		const serialized = JSON.stringify(payload);
		storage.setItem("litellm-mcp-oauth-result", serialized);
		storage.setItem("litellm-user-mcp-oauth-result", serialized);
	} catch {
		// Redirect still completes when browser storage is unavailable.
	}
	let returnUrl: string | null = null;
	try {
		returnUrl = storage.getItem("litellm-mcp-oauth-return-url");
	} catch {
		/* Storage can be unavailable. */
	}
	const uiIndex = currentLocation.pathname.indexOf("/ui");
	const fallback = uiIndex >= 0 ? currentLocation.pathname.slice(0, uiIndex + 3) : "/";
	currentLocation.replace(returnUrl || fallback);
}
