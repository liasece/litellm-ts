import { zstdCompressSync } from "node:zlib";
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

		const sentInit = fetchMock.mock.calls[0]?.[1];
		expect(fetchMock.mock.calls[0]?.[0]).toBe(request.url);
		expect(sentInit?.method).toBe("POST");
		expect(sentInit?.body).toBe(JSON.stringify(request.body));
		expect(sentInit?.signal).toBeInstanceOf(AbortSignal);
		// undici 只自动解码 gzip/deflate/br，请求不再向上游声明 Accept-Encoding。
		expect(sentInit?.headers).toBeInstanceOf(Headers);
		expect((sentInit?.headers as Headers).get("authorization")).toBe("Bearer test");
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

	it("reads a JSON error body for a rejected streaming response", async () => {
		const response = new Response(JSON.stringify({ error: { message: "developer role is invalid" } }), {
			status: 400,
			headers: { "content-type": "application/json" },
		});
		jest.spyOn(global, "fetch").mockResolvedValue(response);

		const result = await executeProviderRequest(request, { readJson: false });

		expect(result.response).toBe(response);
		expect(result.body).toEqual({ error: { message: "developer role is invalid" } });
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

describe("executeProviderRequest upstream encoding and abort diagnostics", () => {
	afterEach(() => {
		jest.restoreAllMocks();
		jest.useRealTimers();
	});

	it("strips accept-encoding so upstream cannot negotiate an encoding undici cannot decode", async () => {
		const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));

		await executeProviderRequest(
			{ ...request, headers: { ...request.headers, "Accept-Encoding": "gzip, deflate, br, zstd" } },
			{ readJson: true },
		);

		const sentHeaders = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
		expect(sentHeaders.get("accept-encoding")).toBeNull();
		expect(sentHeaders.get("authorization")).toBe("Bearer test");
	});

	it("decodes a zstd-encoded upstream body so usage stays readable", async () => {
		const compressed = zstdCompressSync(Buffer.from(JSON.stringify({ usage: { total_tokens: 7 } })));
		jest.spyOn(global, "fetch").mockResolvedValue(
			new Response(compressed, { status: 200, headers: { "content-encoding": "zstd", "content-type": "application/json" } }),
		);

		const result = await executeProviderRequest(request, { readJson: true });

		expect(result.body).toEqual({ usage: { total_tokens: 7 } });
		expect(result.response.headers.get("content-encoding")).toBeNull();
	});

	it("reports the provider timeout together with the upstream url", async () => {
		jest.useFakeTimers();
		jest.spyOn(global, "fetch").mockImplementation((_url, init) => {
			return new Promise((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => reject(new DOMException("This operation was aborted", "AbortError")));
			});
		});

		const pending = expect(executeProviderRequest(request, { timeoutMs: 25 })).rejects.toThrow(
			`Provider request timed out after 25ms (${request.url})`,
		);
		await jest.advanceTimersByTimeAsync(25);

		await pending;
	});

	it("keeps the caller abort reason instead of the bare AbortError message", async () => {
		const clientAbort = new AbortController();
		jest.spyOn(global, "fetch").mockImplementation((_url, init) => {
			return new Promise((_resolve, reject) => {
				init?.signal?.addEventListener("abort", () => reject(new DOMException("This operation was aborted", "AbortError")));
			});
		});

		const pending = executeProviderRequest(request, { signal: clientAbort.signal, timeoutMs: 60_000 });
		clientAbort.abort(new DOMException("客户端在响应完成前断开连接（/v1/messages）", "AbortError"));

		await expect(pending).rejects.toThrow("上游请求已取消：客户端在响应完成前断开连接（/v1/messages）");
	});
});
