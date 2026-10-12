import express from "express";
import request from "supertest";
import { registerUtilRoutes } from "./UtilEndpoints";
it("looks up public cost-map metadata without a registered deployment and rejects missing or unknown names", async () => {
	const app = express();
	registerUtilRoutes(app);
	const response = await request(app).get("/utils/model_info").query({ model: "gpt-4" });
	expect(response.status).toBe(200);
	expect(response.body.custom_llm_provider).toBe("openai");
	expect(response.body.model_info.max_input_tokens).toBeGreaterThan(0);
	expect(response.body.model_info.supported_openai_params).toContain("tools");
	expect((await request(app).get("/utils/model_info")).status).toBe(422);
	expect((await request(app).get("/utils/model_info").query({ model: "synthetic-unknown-model" })).status).toBe(404);
});
