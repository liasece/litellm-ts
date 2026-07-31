import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Providers } from "../provider_info_helpers";
import { CredentialItem } from "../networking";
import EditCredentialModal from "./EditCredentialModal";

vi.mock("../networking", async () => {
	const actual = await vi.importActual("../networking");
	return {
		...actual,
		getProviderCreateMetadata: vi.fn().mockResolvedValue([
			{
				provider: "OpenAI",
				provider_display_name: Providers.OpenAI,
				litellm_provider: "openai",
				default_model_placeholder: "gpt-3.5-turbo",
				credential_fields: [
					{
						key: "api_key",
						label: "OpenAI API Key",
						field_type: "password",
						required: true,
					},
					{
						key: "api_base",
						label: "API Base",
						field_type: "text",
						placeholder: "https://api.openai.com/v1",
						required: true,
					},
				],
			},
			{
				provider: "Anthropic",
				provider_display_name: Providers.Anthropic,
				litellm_provider: "anthropic",
				default_model_placeholder: "claude-3-opus-20240229",
				credential_fields: [
					{
						key: "api_key",
						label: "Anthropic API Key",
						field_type: "password",
						required: true,
					},
				],
			},
		]),
	};
});

const createQueryClient = () =>
	new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
				gcTime: 0,
			},
		},
	});

const mockUploadProps = {
	beforeUpload: vi.fn(),
	onChange: vi.fn(),
};

const mockCredential: CredentialItem = {
	credential_name: "test-credential",
	credential_values: {
		api_key: "test-api-key",
		api_base: "https://api.test.com",
	},
	credential_info: {
		custom_llm_provider: Providers.OpenAI,
	},
};

describe("EditCredentialModal", () => {
	it("should render", () => {
		const queryClient = createQueryClient();
		const onCancel = vi.fn();
		const onUpdateCredential = vi.fn();

		render(
			<QueryClientProvider client={queryClient}>
				<EditCredentialModal
					open={true}
					onCancel={onCancel}
					onUpdateCredential={onUpdateCredential}
					uploadProps={mockUploadProps}
					existingCredential={mockCredential}
				/>
			</QueryClientProvider>,
		);

		expect(screen.getByText("Edit Credential")).toBeInTheDocument();
		expect(screen.getByLabelText("Credential Name:")).toBeInTheDocument();
		expect(screen.getByLabelText("Provider:")).toBeInTheDocument();
	});

	it("places existing values in the edit form and preserves untouched fields", async () => {
		const queryClient = createQueryClient();
		const onUpdateCredential = vi.fn();

		render(
			<QueryClientProvider client={queryClient}>
				<EditCredentialModal
					open={true}
					onCancel={vi.fn()}
					onUpdateCredential={onUpdateCredential}
					uploadProps={mockUploadProps}
					existingCredential={mockCredential}
				/>
			</QueryClientProvider>,
		);

		await waitFor(() => expect(screen.getByLabelText("OpenAI API Key")).toBeInTheDocument());
		expect(screen.getByLabelText("OpenAI API Key")).toHaveValue("test-api-key");
		expect(screen.getByLabelText("API Base")).toHaveValue("https://api.test.com");

		fireEvent.click(screen.getByRole("button", { name: "Update Credential" }));
		await waitFor(() => expect(onUpdateCredential).toHaveBeenCalled());
		expect(onUpdateCredential.mock.calls[0][0]).not.toHaveProperty("api_key");
		expect(onUpdateCredential.mock.calls[0][0]).not.toHaveProperty("api_base");
	});

	it("echoes every value returned by the management API", async () => {
		const queryClient = createQueryClient();
		const onUpdateCredential = vi.fn();
		const maskedCredential: CredentialItem = {
			...mockCredential,
			credential_values: { api_key: "****last", api_base: "****masked" },
		};

		render(
			<QueryClientProvider client={queryClient}>
				<EditCredentialModal
					open={true}
					onCancel={vi.fn()}
					onUpdateCredential={onUpdateCredential}
					uploadProps={mockUploadProps}
					existingCredential={maskedCredential}
				/>
			</QueryClientProvider>,
		);

		await screen.findByLabelText("API Base");
		expect(screen.getByLabelText("OpenAI API Key")).toHaveValue("****last");
		expect(screen.getByLabelText("API Base")).toHaveValue("****masked");
		fireEvent.click(screen.getByRole("button", { name: "Update Credential" }));
		await waitFor(() => expect(onUpdateCredential).toHaveBeenCalled());
		expect(onUpdateCredential.mock.calls[0][0]).not.toHaveProperty("api_base");
	});

	it("rotates a secret only when a replacement is entered and sends an explicit deletion", async () => {
		const queryClient = createQueryClient();
		const onUpdateCredential = vi.fn();

		render(
			<QueryClientProvider client={queryClient}>
				<EditCredentialModal
					open={true}
					onCancel={vi.fn()}
					onUpdateCredential={onUpdateCredential}
					uploadProps={mockUploadProps}
					existingCredential={mockCredential}
				/>
			</QueryClientProvider>,
		);

		const apiKeyInput = await screen.findByLabelText("OpenAI API Key");
		fireEvent.change(apiKeyInput, { target: { value: "replacement-api-key" } });
		fireEvent.click(screen.getByRole("button", { name: "Update Credential" }));
		await waitFor(() => expect(onUpdateCredential).toHaveBeenCalled());
		expect(onUpdateCredential.mock.calls[0][0]).toMatchObject({ api_key: "replacement-api-key" });
	});

	it("sends an explicit deletion only when selected", async () => {
		const queryClient = createQueryClient();
		const onUpdateCredential = vi.fn();

		render(
			<QueryClientProvider client={queryClient}>
				<EditCredentialModal
					open={true}
					onCancel={vi.fn()}
					onUpdateCredential={onUpdateCredential}
					uploadProps={mockUploadProps}
					existingCredential={mockCredential}
				/>
			</QueryClientProvider>,
		);

		await screen.findByLabelText("OpenAI API Key");
		fireEvent.click(screen.getByLabelText("Delete stored api_key"));
		fireEvent.click(screen.getByRole("button", { name: "Update Credential" }));
		await waitFor(() => expect(onUpdateCredential).toHaveBeenCalled());
		expect(onUpdateCredential.mock.calls[0][0]).toMatchObject({ delete_secret_fields: ["api_key"] });
	});

	it("should render initial values", async () => {
		const queryClient = createQueryClient();
		const onCancel = vi.fn();
		const onUpdateCredential = vi.fn();

		render(
			<QueryClientProvider client={queryClient}>
				<EditCredentialModal
					open={true}
					onCancel={onCancel}
					onUpdateCredential={onUpdateCredential}
					uploadProps={mockUploadProps}
					existingCredential={mockCredential}
				/>
			</QueryClientProvider>,
		);

		await waitFor(() => {
			const credentialNameInput = screen.getByLabelText("Credential Name:") as HTMLInputElement;
			expect(credentialNameInput.value).toBe("test-credential");
			expect(credentialNameInput.disabled).toBe(true);
		});
	});
});
