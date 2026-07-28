import express from "express";
import type { AddressInfo } from "node:net";
import http from "node:http";
import { brotliDecompressSync } from "node:zlib";
import { spendResponseCompression } from "./SpendResponseCompression";

describe("spendResponseCompression", () => {
	it("协商 Brotli 后显著缩小大 JSON，解压内容保持不变", async () => {
		const payload = {
			data: Array.from({ length: 20 }, (_, index) => ({
				request_id: `req-${index}`,
				messages: "repeated session history ".repeat(2_000),
			})),
		};
		const app = express();
		app.use("/spend", spendResponseCompression);
		app.get("/spend/session", (_req, res) => res.json(payload));
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
});
