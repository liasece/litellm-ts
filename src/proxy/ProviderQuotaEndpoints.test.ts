import express from "express";
import request from "supertest";
import type { CredentialValuesAccessor, Deployment } from "../types/router";
import { ProviderQuotaService, buildQuotaTargets } from "../providerusage/ProviderQuotaService";
import { registerProviderQuotaRoutes, type ProviderQuotaRouterView } from "./ProviderQuotaEndpoints";

function appWith(view: ProviderQuotaRouterView, service = new ProviderQuotaService()): express.Express {
	const app = express();
	app.use((req, _res, next) => {
		req.auth = { user_role: "proxy_admin" } as never;
		next();
	});
	const router = express.Router();
	registerProviderQuotaRoutes(router, service, view);
	app.use(router);
	return app;
}

describe("ProviderQuotaEndpoints", () => {
	afterEach(() => {
		jest.restoreAllMocks();
	});

	it("returns provider accounts without leaking the configured key", async () => {
		jest.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
			if (String(input).includes("/user/balance")) {
				return new Response(
					JSON.stringify({
						is_available: true,
						balance_infos: [{ currency: "CNY", total_balance: "12.34", granted_balance: "0.00", topped_up_balance: "12.34" }],
					}),
					{ status: 200 },
				);
			}
			return new Response(JSON.stringify({ base_resp: { status_code: 0 }, model_remains: [] }), { status: 200 });
		});

		const deployments: Deployment[] = [
			{
				model_name: "deepseek-flash",
				litellm_params: { model: "deepseek/deepseek-flash", api_key: "sk-deepseek-secret" },
			},
		];
		const credentials: CredentialValuesAccessor = { getValues: () => undefined };
		const app = appWith({ getDeployments: () => deployments, listCredentialValues: () => credentials });

		const response = await request(app).get("/provider/quota");

		expect(response.status).toBe(200);
		expect(response.body.data).toHaveLength(1);
		expect(response.body.data[0].provider).toBe("deepseek");
		expect(response.body.data[0].balances[0]).toMatchObject({ unit: "CNY", remaining: 12.34 });
		expect(JSON.stringify(response.body)).not.toContain("sk-deepseek-secret");
	});

	it("passes the refresh flag through to bypass the cache", async () => {
		const list = jest.fn().mockResolvedValue([]);
		const service = { list: list } as unknown as ProviderQuotaService;
		const app = appWith(
			{ getDeployments: () => [], listCredentialValues: () => undefined },
			service,
		);

		await request(app).get("/provider/quota?refresh=true");

		expect(list).toHaveBeenCalledWith(undefined, [], true);
	});

	it("keeps one failing account in the response instead of failing the list", async () => {
		jest.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("nope", { status: 500 }));
		const targets = buildQuotaTargets(
			[{ model_name: "deepseek-flash", litellm_params: { model: "deepseek/deepseek-flash", api_key: "sk-bad" } }],
			undefined,
		);

		const accounts = await new ProviderQuotaService().list(undefined, [
			{ model_name: "deepseek-flash", litellm_params: { model: "deepseek/deepseek-flash", api_key: "sk-bad" } },
		]);

		expect(targets).toHaveLength(1);
		expect(accounts[0]?.error).toContain("HTTP 500");
		expect(JSON.stringify(accounts)).not.toContain("sk-bad");
	});
});
