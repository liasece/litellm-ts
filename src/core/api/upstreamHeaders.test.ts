import { isForwardableUpstreamHeader } from "./upstreamHeaders";

describe("upstream response header forwarding", () => {
	it.each(["Content-Encoding", "content-length", "Transfer-Encoding", "Connection", "Keep-Alive", "Upgrade"])(
		"drops %s because the body is decoded and re-streamed",
		(name) => {
			expect(isForwardableUpstreamHeader(name)).toBe(false);
		},
	);

	it.each(["Content-Type", "x-request-id", "anthropic-ratelimit-requests-remaining"])("keeps %s", (name) => {
		expect(isForwardableUpstreamHeader(name)).toBe(true);
	});
});
