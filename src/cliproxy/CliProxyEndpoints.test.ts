import express, { type RequestHandler } from "express";
import request from "supertest";
import { registerCliProxyManagementRoutes } from "./CliProxyEndpoints";
import type { CliProxyRuntimeManager } from "./CliProxyRuntimeManager";

function makeRuntime() {
	return {
		managementRequest: jest.fn(async () => Response.json({ status: "ok" })),
		persistManagementConfig: jest.fn(async () => undefined),
	} as unknown as jest.Mocked<CliProxyRuntimeManager>;
}

function makeApp(runtime: CliProxyRuntimeManager, role = "proxy_admin"): express.Express {
	const app = express();
	app.use(express.json());
	app.use(((req, _res, next) => {
		req.auth = { api_key: "sk-test", user_role: role };
		next();
	}) as RequestHandler);
	const router = express.Router();
	registerCliProxyManagementRoutes(router, runtime);
	app.use(router);
	return app;
}

describe("CLIProxy protected management bridge", () => {
	it("forwards allowlisted reads with the original query string", async () => {
		const runtime = makeRuntime();
		runtime.managementRequest.mockResolvedValueOnce(
			new Response(JSON.stringify({ queue: [1] }), { status: 200, headers: { "Content-Type": "application/json" } }),
		);

		const response = await request(makeApp(runtime)).get("/cliproxy/management/usage-queue?limit=20");

		expect(response.status).toBe(200);
		expect(response.body).toEqual({ queue: [1] });
		expect(runtime.managementRequest).toHaveBeenCalledWith("/usage-queue?limit=20", expect.objectContaining({ method: "GET" }));
		expect(runtime.persistManagementConfig).not.toHaveBeenCalled();
	});

	it("persists config-backed mutations into the LiteLLM-owned configuration", async () => {
		const runtime = makeRuntime();

		const response = await request(makeApp(runtime)).patch("/cliproxy/management/request-retry").send({ value: 3 });

		expect(response.status).toBe(200);
		expect(runtime.managementRequest).toHaveBeenCalledWith(
			"/request-retry",
			expect.objectContaining({
				method: "PATCH",
				body: Buffer.from('{"value":3}'),
			}),
		);
		expect(runtime.persistManagementConfig).toHaveBeenCalledTimes(1);
	});

	it("preserves multipart auth-file uploads and native response headers", async () => {
		const runtime = makeRuntime();
		runtime.managementRequest.mockResolvedValueOnce(
			new Response(Buffer.from([0, 1, 2]), {
				status: 200,
				headers: {
					"Content-Type": "application/octet-stream",
					"Content-Disposition": 'attachment; filename="result.bin"',
				},
			}),
		);

		const response = await request(makeApp(runtime))
			.post("/cliproxy/management/auth-files")
			.field("name", "codex.json")
			.attach("file", Buffer.from([0, 255, 17]), "codex.json")
			.buffer(true)
			.parse((res, callback) => {
				const chunks: Buffer[] = [];
				res.on("data", (chunk: Buffer) => chunks.push(chunk));
				res.on("end", () => callback(null, Buffer.concat(chunks)));
			});

		const init = runtime.managementRequest.mock.calls[0]?.[1];
		expect(response.status).toBe(200);
		expect(response.headers["content-disposition"]).toBe('attachment; filename="result.bin"');
		expect(Buffer.isBuffer(init?.body)).toBe(true);
		expect((init?.body as Buffer).includes(Buffer.from([0, 255, 17]))).toBe(true);
	});

	it("rejects viewers even for reads", async () => {
		const runtime = makeRuntime();

		const response = await request(makeApp(runtime, "proxy_admin_viewer")).get("/cliproxy/management/usage-queue");

		expect(response.status).toBe(403);
		expect(runtime.managementRequest).not.toHaveBeenCalled();
	});

	it.each(["config", "config.yaml", "api-keys"])("does not expose the reserved %s resource", async (resource) => {
		const runtime = makeRuntime();

		const response = await request(makeApp(runtime)).get(`/cliproxy/management/${resource}`);

		expect(response.status).toBe(404);
		expect(runtime.managementRequest).not.toHaveBeenCalled();
	});
});
