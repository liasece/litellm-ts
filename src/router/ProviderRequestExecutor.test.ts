import { executeProviderRequest } from "./ProviderRequestExecutor";
import type { ProviderRequest } from "../types/provider";

const request: ProviderRequest = {
	url: "https://provider.example/v1/embeddings",
	method: "POST",
	headers: { Authorization: "Bearer test" },
	body: { model: "embed", input: "hello" },
	model: "embed",
};

describe("executeProviderRequest", () => {
	afterEach(() => {
		jest.restoreAllMocks();
		jest.useRealTimers();
	});

	it("executes a provider request and reads JSON", async () => {
		const response = new Response(JSON.stringify({ data: [{ embedding: [1] }] }), {
			status: 200,
			headers: { "content-type": "application/json" },
		});
		const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(response);

		const result = await executeProviderRequest(request, { readJson: true, timeoutMs: 1_000 });

		expect(fetchMock).toHaveBeenCalledWith(request.url, {
			method: "POST",
			headers: request.headers,
			body: JSON.stringify(request.body),
			signal: expect.any(AbortSignal),
		});
		expect(result.response).toBe(response);
		expect(result.body).toEqual({ data: [{ embedding: [1] }] });
		expect(result.latencyMs).toBeGreaterThanOrEqual(0);
	});

	it("leaves a streaming response body unread", async () => {
		const response = new Response("data: test\n\n", { status: 200 });
		jest.spyOn(global, "fetch").mockResolvedValue(response);

		const result = await executeProviderRequest(request, { readJson: false });

		expect(result.body).toBeUndefined();
		expect(await result.response.text()).toBe("data: test\n\n");
	});

	it("aborts a request when the timeout expires", async () => {
		jest.useFakeTimers();
		jest.spyOn(global, "fetch").mockImplementation((_url, init) => {
			return new Promise((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
			});
		});

		const pending = expect(executeProviderRequest(request, { timeoutMs: 10 })).rejects.toMatchObject({ name: "TimeoutError" });
		await jest.advanceTimersByTimeAsync(10);

		await pending;
	});

	it("combines client abort with provider timeout and aborts the upstream fetch", async () => {
		const clientAbort = new AbortController();
		let upstreamSignal: AbortSignal | undefined;
		jest.spyOn(global, "fetch").mockImplementation((_url, init) => {
			upstreamSignal = init?.signal ?? undefined;
			return new Promise((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
			});
		});

		const pending = expect(executeProviderRequest(request, { signal: clientAbort.signal, timeoutMs: 60_000 })).rejects.toMatchObject({
			name: "AbortError",
		});
		clientAbort.abort();

		await pending;
		expect(upstreamSignal?.aborted).toBe(true);
	});
});
