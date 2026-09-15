import express from "express";
import type { AddressInfo } from "node:net";
import http from "node:http";
import { zstdCompressSync } from "node:zlib";
import { zstdRequestDecompress } from "./ZstdRequestDecompress";

describe("zstdRequestDecompress", () => {
	const startServer = async (): Promise<http.Server> => {
		const app = express();
		app.use(zstdRequestDecompress);
		app.use(express.json());
		app.post("/v1/responses", (req, res) => res.json({ received: req.body }));
		return new Promise<http.Server>((resolve, reject) => {
			const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
			listeningServer.once("error", reject);
		});
	};

	const post = (
		port: number,
		body: Buffer,
		headers: Record<string, string>,
	): Promise<{ status: number; body: string }> =>
		new Promise((resolve, reject) => {
			const request = http.request(
				{
					hostname: "127.0.0.1",
					port: port,
					path: "/v1/responses",
					method: "POST",
					headers: { "content-type": "application/json", ...headers },
				},
				(response) => {
					const chunks: Buffer[] = [];
					response.on("data", (chunk: Buffer) => chunks.push(chunk));
					response.on("end", () =>
						resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
					);
				},
			);
			request.once("error", reject);
			request.end(body);
		});

	it("解压 zstd 请求体并正常解析 JSON", async () => {
		const server = await startServer();
		try {
			const port = (server.address() as AddressInfo).port;
			const payload = { model: "gpt-5", input: "hello" };
			const compressed = zstdCompressSync(Buffer.from(JSON.stringify(payload)));
			const result = await post(port, compressed, { "content-encoding": "zstd" });
			expect(result.status).toBe(200);
			expect(JSON.parse(result.body)).toEqual({ received: payload });
		} finally {
			server.close();
		}
	});

	it("普通 JSON 请求不受影响", async () => {
		const server = await startServer();
		try {
			const port = (server.address() as AddressInfo).port;
			const payload = { model: "gpt-5" };
			const result = await post(port, Buffer.from(JSON.stringify(payload)), {});
			expect(result.status).toBe(200);
			expect(JSON.parse(result.body)).toEqual({ received: payload });
		} finally {
			server.close();
		}
	});

	it("损坏的 zstd 数据返回 400", async () => {
		const server = await startServer();
		try {
			const port = (server.address() as AddressInfo).port;
			const result = await post(port, Buffer.from("not-zstd-data!!"), {
				"content-encoding": "zstd",
			});
			expect(result.status).toBe(400);
		} finally {
			server.close();
		}
	});
});
