import { CredentialItem } from "@/components/networking";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { UploadProps } from "antd/es/upload";
import { describe, expect, it, vi } from "vitest";
import CredentialsPanel from "./credentials";

const DEFAULT_UPLOAD_PROPS = {} as UploadProps;

const mockUseAuthorized = vi.fn();
const mockUseCredentials = vi.fn();
const { mockCredentialDeleteCall, mockCredentialUpdateCall, mockNotificationError } = vi.hoisted(() => ({
	mockCredentialDeleteCall: vi.fn(),
	mockCredentialUpdateCall: vi.fn(),
	mockNotificationError: vi.fn(),
}));

vi.mock("@/components/networking", async () => {
	const actual = await vi.importActual("@/components/networking");
	return {
		...actual,
		credentialDeleteCall: mockCredentialDeleteCall,
		credentialUpdateCall: mockCredentialUpdateCall,
		getProviderCreateMetadata: vi.fn().mockResolvedValue([
			{
				provider: "OpenAI",
				provider_display_name: "OpenAI",
				litellm_provider: "openai",
				credential_fields: [
					{ key: "api_key", label: "OpenAI API Key", field_type: "password", required: true },
					{ key: "api_base", label: "API Base", field_type: "text" },
				],
			},
		]),
	};
});

vi.mock("@/app/(dashboard)/hooks/useAuthorized", () => ({
	default: () => mockUseAuthorized(),
}));

vi.mock("@/app/(dashboard)/hooks/credentials/useCredentials", () => ({
	useCredentials: () => mockUseCredentials(),
}));

vi.mock("../molecules/notifications_manager", () => ({
	default: {
		error: mockNotificationError,
		success: vi.fn(),
	},
}));

const createQueryClient = () =>
	new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
				gcTime: 0,
			},
		},
	});

describe("CredentialsPanel", () => {
	it("should render", () => {
		mockUseAuthorized.mockReturnValue({ accessToken: "test-token" });
		mockUseCredentials.mockReturnValue({
			data: { credentials: [] },
			refetch: vi.fn(),
		});

		render(
			<QueryClientProvider client={createQueryClient()}>
				<CredentialsPanel uploadProps={DEFAULT_UPLOAD_PROPS} />
			</QueryClientProvider>,
		);

		expect(screen.getByRole("button", { name: /add credential/i })).toBeInTheDocument();
	});

	it("should display provided credentials", () => {
		const credentials: CredentialItem[] = [
			{
				credential_name: "openai-key",
				credential_values: {},
				credential_info: { custom_llm_provider: "openai" },
			},
		];

		mockUseAuthorized.mockReturnValue({ accessToken: "test-token" });
		mockUseCredentials.mockReturnValue({
			data: { credentials },
			refetch: vi.fn(),
		});

		render(
			<QueryClientProvider client={createQueryClient()}>
				<CredentialsPanel uploadProps={DEFAULT_UPLOAD_PROPS} />
			</QueryClientProvider>,
		);

		expect(screen.getByText("openai-key")).toBeInTheDocument();
	});

	it("should display empty state when no credentials are provided", () => {
		mockUseAuthorized.mockReturnValue({ accessToken: "test-token" });
		mockUseCredentials.mockReturnValue({
			data: { credentials: [] },
			refetch: vi.fn(),
		});

		render(
			<QueryClientProvider client={createQueryClient()}>
				<CredentialsPanel uploadProps={DEFAULT_UPLOAD_PROPS} />
			</QueryClientProvider>,
		);

		expect(screen.getByText("No credentials configured")).toBeInTheDocument();
	});

	it("opens details and renders every credential value", () => {
		const secret = "never-render-this-secret";
		mockUseAuthorized.mockReturnValue({ accessToken: "test-token" });
		mockUseCredentials.mockReturnValue({
			data: {
				credentials: [
					{
						credential_name: "openai-key",
						credential_values: { api_key: secret, api_base: "https://api.example.com" },
						credential_info: { custom_llm_provider: "openai", region: "us-east-1" },
					},
				],
			},
			refetch: vi.fn(),
		});

		render(
			<QueryClientProvider client={createQueryClient()}>
				<CredentialsPanel uploadProps={DEFAULT_UPLOAD_PROPS} />
			</QueryClientProvider>,
		);

		fireEvent.click(screen.getByText("openai-key"));

		expect(screen.getByText("api_key")).toBeInTheDocument();
		expect(screen.getByText("api_base")).toBeInTheDocument();
		expect(screen.getByText("us-east-1")).toBeInTheDocument();
		expect(screen.getByText(secret)).toBeInTheDocument();
		expect(screen.getByText("https://api.example.com")).toBeInTheDocument();
	});

	it("patches only dirty fields, converts explicit deletion to null, and refetches", async () => {
		const refetch = vi.fn().mockResolvedValue(undefined);
		mockCredentialUpdateCall.mockResolvedValue({ success: true });
		mockUseAuthorized.mockReturnValue({ accessToken: "test-token" });
		mockUseCredentials.mockReturnValue({
			data: {
				credentials: [
					{
						credential_name: "openai-key",
						credential_values: { api_key: "****last", api_base: "https://old.example.com" },
						credential_info: { custom_llm_provider: "openai" },
					},
				],
			},
			refetch,
		});

		render(
			<QueryClientProvider client={createQueryClient()}>
				<CredentialsPanel uploadProps={DEFAULT_UPLOAD_PROPS} />
			</QueryClientProvider>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Edit credential openai-key" }));
		await screen.findByText("Edit Credential");
		fireEvent.change(await screen.findByLabelText("API Base"), { target: { value: "https://new.example.com" } });
		fireEvent.click(screen.getByLabelText("Delete stored api_key"));
		fireEvent.click(screen.getByRole("button", { name: "Update Credential" }));

		await waitFor(() =>
			expect(mockCredentialUpdateCall).toHaveBeenCalledWith("test-token", "openai-key", {
				credential_name: "openai-key",
				credential_values: {
					api_base: "https://new.example.com",
					api_key: null,
				},
			}),
		);
		expect(refetch).toHaveBeenCalled();
	});

	it("shows the backend conflict message when a referenced credential cannot be deleted", async () => {
		mockCredentialDeleteCall.mockRejectedValue(new Error("Credential is referenced by one or more models"));
		mockUseAuthorized.mockReturnValue({ accessToken: "test-token" });
		mockUseCredentials.mockReturnValue({
			data: {
				credentials: [
					{
						credential_name: "openai-key",
						credential_values: { api_key: "********" },
						credential_info: { custom_llm_provider: "openai" },
					},
				],
			},
			refetch: vi.fn(),
		});

		render(
			<QueryClientProvider client={createQueryClient()}>
				<CredentialsPanel uploadProps={DEFAULT_UPLOAD_PROPS} />
			</QueryClientProvider>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Delete credential openai-key" }));
		await screen.findByText("Delete Credential?");
		fireEvent.change(screen.getByRole("textbox"), { target: { value: "openai-key" } });
		fireEvent.click(screen.getByRole("button", { name: "Delete" }));

		await waitFor(() =>
			expect(mockNotificationError).toHaveBeenCalledWith("Credential is referenced by one or more models"),
		);
	});

	it("should open add modal when add button is clicked", async () => {
		mockUseAuthorized.mockReturnValue({ accessToken: "test-token" });
		mockUseCredentials.mockReturnValue({
			data: { credentials: [] },
			refetch: vi.fn(),
		});

		render(
			<QueryClientProvider client={createQueryClient()}>
				<CredentialsPanel uploadProps={DEFAULT_UPLOAD_PROPS} />
			</QueryClientProvider>,
		);

		const addButton = screen.getByRole("button", { name: /add credential/i });

		act(() => {
			fireEvent.click(addButton);
		});

		await waitFor(() => {
			expect(screen.getByText("Add New Credential")).toBeInTheDocument();
		});
	});
});
