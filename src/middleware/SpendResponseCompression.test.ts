import express from "express";
import type { AddressInfo } from "node:net";
import http from "node:http";
import { brotliDecompressSync, createBrotliDecompress, createGunzip, createInflate } from "node:zlib";
import { spendResponseCompression } from "./SpendResponseCompression";

/** 在回环地址的随机端口上启动应用，供流式断言使用。 */
function listenOnEphemeralPort(app: express.Express): Promise<http.Server> {
	return new Promise<http.Server>((resolve, reject) => {
		const server = app.listen(0, "127.0.0.1", () => resolve(server));
		server.once("error", reject);
	});
}

/** 关闭测试服务器并等待端口释放。 */
function closeServer(server: http.Server): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		server.close((error) => (error ? reject(error) : resolve()));
	});
}

/** 按响应声明的编码建立解压流，未压缩时返回 undefined。 */
function decoderFor(encoding: string | undefined) {
	if (encoding === "br") return createBrotliDecompress();
	if (encoding === "gzip") return createGunzip();
	if (encoding === "deflate") return createInflate();
	return undefined;
}

describe("spendResponseCompression", () => {
	it("协商 Brotli 后显著缩小大 JSON，解压内容保持不变", async () => {
		const payload = {
			data: Array.from({ length: 20 }, (_, index) => ({
				request_id: `req-${index}`,
				messages: "repeated session history ".repeat(2_000),
			})),
		};
		// 与生产一致：压缩中间件挂在 router 级，router 以空前缀挂载，消费路径仍是 /spend/*。
		const spendRouter = express.Router();
		spendRouter.use(spendResponseCompression);
		spendRouter.get("/spend/session", (_req, res) => res.json(payload));
		const app = express();
		app.use(spendRouter);
		const server = await new Promise<http.Server>((resolve, reject) => {
			const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
			listeningServer.once("error", reject);
		});

		try {
			const port = (server.address() as AddressInfo).port;
			const response = await new Promise<{ headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
				http
					.get(
						{
							hostname: "127.0.0.1",
							port: port,
							path: "/spend/session",
							headers: { "Accept-Encoding": "br, gzip" },
						},
						(incoming) => {
							const chunks: Buffer[] = [];
							incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
							incoming.on("end", () => resolve({ headers: incoming.headers, body: Buffer.concat(chunks) }));
						},
					)
					.on("error", reject);
			});

			expect(response.headers["content-encoding"]).toBe("br");
			expect(response.headers.vary).toContain("Accept-Encoding");
			expect(response.body.length).toBeLessThan(Buffer.byteLength(JSON.stringify(payload)) / 10);
			expect(JSON.parse(brotliDecompressSync(response.body).toString("utf8"))).toEqual(payload);
		} finally {
			await new Promise<void>((resolve, reject) => {
				server.close((error) => (error ? reject(error) : resolve()));
			});
		}
	});

	it("以空前缀挂载时不接管下游路由的事件流，首块在流结束前到达", async () => {
		// 复刻生产装配：压缩中间件挂在 router 级，router 以空前缀先于推理端点挂载，
		// 真正写 SSE 的 /v1/responses 落在下游路由。
		const spendRouter = express.Router();
		spendRouter.use(spendResponseCompression);
		const app = express();
		app.use(spendRouter);

		let secondWriteAt = Number.POSITIVE_INFINITY;
		app.post("/v1/responses", async (_req, res) => {
			res.status(200);
			res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
			res.setHeader("Cache-Control", "no-cache");
			res.flushHeaders();
			res.write('event: response.created\ndata: {"type":"response.created"}\n\n');
			await new Promise((resolve) => setTimeout(resolve, 300));
			secondWriteAt = Date.now();
			res.write('event: response.completed\ndata: {"type":"response.completed"}\n\n');
			res.end();
		});

		const server = await listenOnEphemeralPort(app);
		try {
			const port = (server.address() as AddressInfo).port;
			const response = await new Promise<{ headers: http.IncomingHttpHeaders; firstEventAt: number; body: string }>(
				(resolve, reject) => {
					const request = http.request(
						{
							hostname: "127.0.0.1",
							port: port,
							path: "/v1/responses",
							method: "POST",
							headers: { "Content-Type": "application/json", "Accept-Encoding": "gzip, br" },
						},
						(incoming) => {
							// 编码无关地判断“首个事件何时可读”：压缩流只在压缩器吐出数据后才看得到文本，
							// 因此该时间点能直接反映客户端感知到的首字延迟。
							let text = "";
							let firstEventAt = Number.NaN;
							const consume = (chunk: Buffer): void => {
								text += chunk.toString("utf8");
								if (Number.isNaN(firstEventAt) && text.includes("response.created")) {
									firstEventAt = Date.now();
								}
							};
							const decoder = decoderFor(incoming.headers["content-encoding"]);
							if (decoder === undefined) {
								incoming.on("data", consume);
								incoming.on("end", () =>
									resolve({ headers: incoming.headers, firstEventAt: firstEventAt, body: text }),
								);
								return;
							}
							decoder.on("data", consume);
							decoder.on("end", () => resolve({ headers: incoming.headers, firstEventAt: firstEventAt, body: text }));
							incoming.pipe(decoder);
						},
					);
					request.on("error", reject);
					request.end(JSON.stringify({ model: "test-model", input: "hi", stream: true }));
				},
			);

			// 被消费压缩器接管的 SSE 会攒到 res.end() 才可读，首事件必然晚于第二次写入；
			// 修复后客户端在服务端仍等待时就已读到首个事件。
			expect(response.headers["content-encoding"]).toBeUndefined();
			expect(response.firstEventAt).toBeLessThan(secondWriteAt);
			expect(response.body).toContain("response.created");
			expect(response.body).toContain("response.completed");
		} finally {
			await closeServer(server);
		}
	});
});
