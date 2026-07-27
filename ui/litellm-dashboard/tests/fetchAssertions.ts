import { expect, type Mock } from "vitest";

/**
 * Assert the dashboard's HttpOnly-session transport without coupling tests to
 * the concrete Headers implementation used by fetch.
 */
export function expectSessionFetchCall(
	fetchMock: Mock,
	expectedUrl: string,
	expectedInit: Pick<RequestInit, "method" | "body"> = {},
): void {
	const call = fetchMock.mock.calls.find(([url]) => String(url) === expectedUrl);
	expect(call, `Expected a session fetch call to ${expectedUrl}`).toBeDefined();
	const [, init] = call as [RequestInfo | URL, RequestInit];
	expect(init).toEqual(
		expect.objectContaining({
			...expectedInit,
			credentials: "include",
		}),
	);
	const headers = new Headers(init.headers);
	expect(headers.get("Authorization")).toBeNull();
	expect(headers.get("x-api-key")).toBeNull();
}
