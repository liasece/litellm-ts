import { render, screen } from "@testing-library/react";
import { Form } from "antd";
import { describe, expect, it } from "vitest";
import { Providers } from "../provider_info_helpers";
import ConditionalPublicModelName from "./conditional_public_model_name";

describe("ConditionalPublicModelName", () => {
	it("should render", () => {
		render(
			<Form
				initialValues={{
					model: ["gpt-4"],
					model_mappings: [
						{
							public_name: "gpt-4",
							litellm_model: "gpt-4",
						},
					],
				}}
			>
				<ConditionalPublicModelName />
			</Form>,
		);

		expect(screen.getByText("Model Mappings")).toBeInTheDocument();
		expect(screen.getByText("Public Model Name")).toBeInTheDocument();
		expect(screen.getByText("LiteLLM Model Name")).toBeInTheDocument();
	});

	it("keeps the managed CLIProxy prefix when it derives model mappings", async () => {
		render(
			<Form
				initialValues={{
					custom_llm_provider: Providers.CLIProxy,
					model: ["gpt-5.4"],
					model_mappings: [],
				}}
			>
				<Form.Item name="custom_llm_provider" hidden>
					<input />
				</Form.Item>
				<Form.Item name="model" hidden>
					<input />
				</Form.Item>
				<ConditionalPublicModelName />
			</Form>,
		);

		expect(await screen.findByText("cliproxy/gpt-5.4")).toBeInTheDocument();
	});
});
