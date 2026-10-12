import express from "express";
import request from "supertest";
import { registerResponsesApiRoutes } from "./ResponsesApiEndpoints";

describe("Responses input_tokens read-only contract", () => {
	const app = express();
	app.use(express.json());
	app.use((req, _res, next) => {
		req.auth = { api_key: "test-key", models: ["allowed"], max_budget: 0, spend: 10 };
		next();
	});
	registerResponsesApiRoutes(app);
	it.each(["/v1/responses/input_tokens", "/responses/input_tokens", "/openai/v1/responses/input_tokens"])(
		"counts without reserving or executing completion at %s",
		async (path) => {
			const short = await request(app).post(path).send({ model: "allowed", input: "hello" });
			const rich = await request(app)
				.post(path)
				.send({
					model: "allowed",
					input: [
						{ type: "function_call", name: "weather", call_id: "id", arguments: '{"city":"Paris"}' },
						{ type: "function_call_output", call_id: "id", output: "sunny" },
					],
					instructions: "You are terse",
					tools: [
						{ type: "function", name: "weather", parameters: { type: "object", properties: { city: { type: "string" } } } },
					],
				});
			expect(short.status).toBe(200);
			expect(short.body.object).toBe("response.input_tokens");
			expect(rich.body.input_tokens).toBeGreaterThan(short.body.input_tokens);
		},
	);
	it("enforces model access and rejects missing or unavailable stored context", async () => {
		expect((await request(app).post("/responses/input_tokens").send({ model: "forbidden", input: "hello" })).status).toBe(403);
		expect((await request(app).post("/responses/input_tokens").send({ model: "allowed", input: [] })).status).toBe(400);
		expect(
			(
				await request(app)
					.post("/responses/input_tokens")
					.send({ model: "allowed", input: "hello", previous_response_id: "resp_previous" })
			).status,
		).toBe(400);
	});
});
