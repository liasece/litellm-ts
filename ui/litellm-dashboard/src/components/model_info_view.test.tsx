import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SIDE_PANEL_WIDTH } from "./common_components/SidePanel";
import ModelInfoView, { attachCredentialToModel } from "./model_info_view";
import NotificationsManager from "./molecules/notifications_manager";
import * as networking from "./networking";

vi.mock("../../utils/dataUtils", () => ({
	copyToClipboard: vi.fn().mockResolvedValue(true),
}));

vi.mock("./molecules/notifications_manager", () => ({
	default: {
		success: vi.fn(),
		error: vi.fn(),
		info: vi.fn(),
		fromBackend: vi.fn(),
	},
}));

vi.mock("./networking", () => ({
	modelInfoV1Call: vi.fn(),
	modelRawInfoCall: vi.fn(),
	credentialGetCall: vi.fn(),
	credentialListCall: vi.fn(),
	getGuardrailsList: vi.fn(),
	tagListCall: vi.fn(),
	testConnectionRequest: vi.fn(),
	modelPatchUpdateCall: vi.fn(),
	modelDeleteCall: vi.fn(),
	credentialCreateCall: vi.fn(),
	builtinCapabilitiesCall: vi.fn(),
	vectorStoreListCall: vi.fn().mockResolvedValue({ vector_stores: [] }),
}));

const mockUseModelsInfo = vi.fn();
const mockUseModelHub = vi.fn();
const mockUseAllProxyModels = vi.fn();

vi.mock("@/app/(dashboard)/hooks/models/useModels", () => ({
	useModelsInfo: (...args: any[]) => mockUseModelsInfo(...args),
	useModelHub: (...args: any[]) => mockUseModelHub(...args),
	useAllProxyModels: (...args: any[]) => mockUseAllProxyModels(...args),
}));

const mockUseModelCostMap = vi.fn();
vi.mock("@/app/(dashboard)/hooks/models/useModelCostMap", () => ({
	useModelCostMap: (...args: any[]) => mockUseModelCostMap(...args),
}));

const mockUseProviderFields = vi.fn();
vi.mock("@/app/(dashboard)/hooks/providers/useProviderFields", () => ({
	useProviderFields: (...args: any[]) => mockUseProviderFields(...args),
}));

const mockNotificationsManager = vi.mocked(NotificationsManager);
const mockModelInfoV1Call = vi.mocked(networking.modelInfoV1Call);
const mockModelRawInfoCall = vi.mocked(networking.modelRawInfoCall);
const mockCredentialGetCall = vi.mocked(networking.credentialGetCall);
const mockCredentialListCall = vi.mocked(networking.credentialListCall);
const mockGetGuardrailsList = vi.mocked(networking.getGuardrailsList);
const mockTagListCall = vi.mocked(networking.tagListCall);
const mockTestConnectionRequest = vi.mocked(networking.testConnectionRequest);
const mockModelPatchUpdateCall = vi.mocked(networking.modelPatchUpdateCall);
const mockModelDeleteCall = vi.mocked(networking.modelDeleteCall);
const mockCredentialCreateCall = vi.mocked(networking.credentialCreateCall);
const mockBuiltinCapabilitiesCall = vi.mocked(networking.builtinCapabilitiesCall);

describe("ModelInfoView", () => {
	let queryClient: QueryClient;

	const defaultModelData = {
		model_name: "GPT-4",
		litellm_params: {
			model: "gpt-4",
			api_base: "https://api.openai.com/v1",
			custom_llm_provider: "openai",
			litellm_credential_name: "selected-credential",
		},
		model_info: {
			id: "123",
			created_by: "123",
			created_at: "2024-01-01T00:00:00Z",
			db_model: true,
			input_cost_per_token: 0.00003,
			output_cost_per_token: 0.00006,
		},
	};

	const DEFAULT_ADMIN_PROPS = {
		modelId: "123",
		onClose: vi.fn(),
		accessToken: "test-token",
		userID: "123",
		userRole: "Admin",
		onModelUpdate: vi.fn(),
		modelAccessGroups: ["group1", "group2"],
	};

	beforeEach(() => {
		queryClient = new QueryClient({
			defaultOptions: {
				queries: {
					retry: false,
				},
			},
		});
		vi.clearAllMocks();
		mockBuiltinCapabilitiesCall.mockResolvedValue({
			capabilities: {
				vision: {
					enabled: true,
					always_inject: false,
					handler_model: "gpt-5.4-mini",
					fallback_models: [],
					max_iterations: 4,
					max_output_tokens: 2048,
				},
			},
			available_models: [],
		});

		mockUseModelsInfo.mockReturnValue({
			data: {
				data: [defaultModelData],
			},
			isLoading: false,
			error: null,
		});

		mockUseModelHub.mockReturnValue({
			data: {
				data: [],
			},
			isLoading: false,
			error: null,
		});
		mockUseAllProxyModels.mockReturnValue({
			data: { data: [{ id: "GPT-4" }, { id: "temporary-model" }] },
			isLoading: false,
			error: null,
		});

		mockUseModelCostMap.mockReturnValue({
			data: {},
			isLoading: false,
			error: null,
		});
		mockUseProviderFields.mockReturnValue({
			data: [
				{
					provider: "OpenAI",
					provider_display_name: "OpenAI",
					litellm_provider: "openai",
					credential_fields: [],
				},
				{
					provider: "CLIProxy",
					provider_display_name: "CLIProxy",
					litellm_provider: "cliproxy",
					credential_fields: [],
				},
			],
			isLoading: false,
			error: null,
		});

		mockModelInfoV1Call.mockResolvedValue({
			data: [defaultModelData],
		});
		mockModelRawInfoCall.mockResolvedValue({
			model_id: "123",
			model_name: "GPT-4",
			litellm_params: { ...defaultModelData.litellm_params, api_key: "sk-raw-secret" },
			model_info: defaultModelData.model_info,
			created_at: "2024-01-01T00:00:00Z",
			created_by: "123",
			updated_at: "2024-01-01T00:00:00Z",
			updated_by: "123",
		});

		mockCredentialGetCall.mockResolvedValue({
			credential_name: "test-credential",
			credential_values: {},
			credential_info: {},
		});
		mockCredentialListCall.mockResolvedValue({
			credentials: [
				{
					credential_name: "selected-credential",
					credential_values: {},
					credential_info: {},
				},
			],
		});

		mockGetGuardrailsList.mockResolvedValue({
			guardrails: [{ guardrail_name: "content_filter" }, { guardrail_name: "toxicity_filter" }],
		});

		mockTagListCall.mockResolvedValue({
			test_tag: {
				name: "test_tag",
				description: "A test tag",
				models: [],
				created_at: "2024-01-01T00:00:00Z",
				updated_at: "2024-01-01T00:00:00Z",
			},
			production_tag: {
				name: "production_tag",
				description: "Production ready models",
				models: [],
				created_at: "2024-01-01T00:00:00Z",
				updated_at: "2024-01-01T00:00:00Z",
			},
		});

		mockTestConnectionRequest.mockResolvedValue({
			status: "success",
		});

		mockModelPatchUpdateCall.mockResolvedValue({});
		mockModelDeleteCall.mockResolvedValue({});
		mockCredentialCreateCall.mockResolvedValue({});
	});

	const wrapper = ({ children }: { children: ReactNode }) =>
		React.createElement(QueryClientProvider, { client: queryClient }, children);

	it("should render", async () => {
		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });
		await waitFor(() => {
			expect(screen.getByText("Model Settings")).toBeInTheDocument();
		});
	});

	it("shows values resolved from the selected Credential in gray with source annotations", async () => {
		mockCredentialListCall.mockResolvedValue({
			credentials: [
				{
					credential_name: "selected-credential",
					credential_values: {
						api_base: "https://credential.example/v1",
						custom_llm_provider: "anthropic",
					},
					credential_info: {},
				},
			],
		});

		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });

		expect(await screen.findByText("https://credential.example/v1")).toHaveClass("text-gray-400");
		expect(screen.getByText("anthropic")).toHaveClass("text-gray-400");
		expect(screen.getAllByText("(from Credentials)")).toHaveLength(2);
	});

	it("renders the exact database row, including the unmasked API key, in Raw JSON", async () => {
		const user = userEvent.setup();
		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });

		await waitFor(() => expect(mockModelRawInfoCall).toHaveBeenCalledWith("test-token", "123"));
		await user.click(screen.getByText("Raw JSON"));

		expect(await screen.findByText(/"api_key": "sk-raw-secret"/)).toBeInTheDocument();
	});

	it("should display loading state when model data is loading", () => {
		mockUseModelsInfo.mockReturnValue({
			data: null,
			isLoading: true,
			error: null,
		});

		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });
		expect(screen.getByText("Loading...")).toBeInTheDocument();
	});

	it("should display not found message when model data is not available", async () => {
		mockUseModelsInfo.mockReturnValue({
			data: {
				data: [],
			},
			isLoading: false,
			error: null,
		});

		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });
		await waitFor(() => {
			expect(screen.getByText("Model not found")).toBeInTheDocument();
		});
	});

	it("should display model name in the header", async () => {
		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });
		await waitFor(() => {
			expect(screen.getByText(/Public Model Name:/)).toBeInTheDocument();
		});
	});

	it("keeps the details Drawer between 50% and 80% of the viewport width", async () => {
		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });

		await screen.findByText("Model Settings");
		expect(document.querySelector(".ant-drawer-content-wrapper")).toHaveStyle({
			width: SIDE_PANEL_WIDTH,
		});
	});

	it("closes through the Drawer without rendering a page-level back button", async () => {
		const mockOnClose = vi.fn();
		const user = userEvent.setup();
		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} onClose={mockOnClose} />, { wrapper });

		await screen.findByText("Model Settings");
		expect(screen.queryByRole("button", { name: /back to models/i })).not.toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "Close" }));

		expect(mockOnClose).toHaveBeenCalledTimes(1);
	});

	it("should display test connection button", async () => {
		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });
		await waitFor(() => {
			expect(screen.getByRole("button", { name: /test connection/i })).toBeInTheDocument();
		});
	});

	it("should test connection when test connection button is clicked", async () => {
		const user = userEvent.setup();
		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });

		await waitFor(() => {
			expect(screen.getByText("Model Settings")).toBeInTheDocument();
		});

		const testButton = screen.getByRole("button", { name: /test connection/i });
		await user.click(testButton);

		await waitFor(() => {
			expect(mockTestConnectionRequest).toHaveBeenCalled();
			expect(mockNotificationsManager.success).toHaveBeenCalledWith("Connection test successful!");
		});
	});

	it("should display error notification when connection test fails", async () => {
		const user = userEvent.setup();
		mockTestConnectionRequest.mockRejectedValue(new Error("Connection failed"));

		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });

		await waitFor(() => {
			expect(screen.getByText("Model Settings")).toBeInTheDocument();
		});

		const testButton = screen.getByRole("button", { name: /test connection/i });
		await user.click(testButton);

		await waitFor(() => {
			expect(mockNotificationsManager.error).toHaveBeenCalled();
		});
	});

	it("should display reuse credentials button for admin users", async () => {
		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });
		await waitFor(() => {
			expect(screen.getByRole("button", { name: /re-use credentials/i })).toBeInTheDocument();
		});
	});

	it("should disable reuse credentials button for non-admin users", async () => {
		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} userRole="User" />, { wrapper });
		await waitFor(() => {
			const button = screen.getByRole("button", { name: /re-use credentials/i });
			expect(button).toBeDisabled();
		});
	});

	it("reuses credentials server-side without sending credential values and refetches state", async () => {
		const user = userEvent.setup();
		const modelWithoutCredential = {
			...defaultModelData,
			litellm_params: {
				...defaultModelData.litellm_params,
				litellm_credential_name: "",
			},
		};
		mockUseModelsInfo.mockReturnValue({
			data: { data: [modelWithoutCredential] },
			isLoading: false,
			error: null,
		});
		mockCredentialGetCall.mockResolvedValue({
			credential_name: "stored-credential",
			credential_values: { api_key: "****last" },
			credential_info: { custom_llm_provider: "openai" },
		});

		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });
		await user.click(await screen.findByRole("button", { name: /re-use credentials/i }));
		await user.click(await screen.findByRole("button", { name: "Reuse Credentials" }));

		await waitFor(() => expect(mockCredentialCreateCall).toHaveBeenCalled());
		expect(mockCredentialCreateCall).toHaveBeenCalledWith(
			"test-token",
			expect.objectContaining({
				credential_name: "stored-credential",
				model_id: "123",
				attach_to_model: true,
				credential_info: { custom_llm_provider: "openai" },
			}),
		);
		expect(mockCredentialCreateCall.mock.calls[0][1]).not.toHaveProperty("credential_values");
		expect(mockCredentialListCall).toHaveBeenCalledTimes(2);
		expect(mockModelInfoV1Call).toHaveBeenCalledWith("test-token", "123");
	});

	it("uses the refetched credential state immediately and preserves it on the next save", async () => {
		const user = userEvent.setup();
		const modelWithoutCredential = {
			...defaultModelData,
			litellm_params: { ...defaultModelData.litellm_params, litellm_credential_name: "" },
		};
		const reusedModel = {
			...modelWithoutCredential,
			litellm_params: { ...modelWithoutCredential.litellm_params, litellm_credential_name: "reused-credential" },
		};
		const onModelUpdate = vi.fn();
		mockUseModelsInfo.mockReturnValue({ data: { data: [modelWithoutCredential] }, isLoading: false, error: null });
		mockModelInfoV1Call.mockResolvedValue({ data: [reusedModel] });

		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} onModelUpdate={onModelUpdate} />, { wrapper });
		await user.click(await screen.findByRole("button", { name: /re-use credentials/i }));
		await user.click(await screen.findByRole("button", { name: "Reuse Credentials" }));

		await waitFor(() =>
			expect(onModelUpdate).toHaveBeenCalledWith(
				expect.objectContaining({
					litellm_model_name: "gpt-4",
					litellm_params: expect.objectContaining({ litellm_credential_name: "reused-credential" }),
				}),
			),
		);
		await user.click(screen.getByRole("button", { name: /re-use credentials/i }));
		expect(await screen.findAllByText("reused-credential")).toHaveLength(2);
		await user.keyboard("{Escape}");

		const patchedModel = { ...reusedModel, model_name: "server-canonical-model" };
		mockModelPatchUpdateCall.mockResolvedValue(patchedModel);
		await user.click(screen.getByRole("button", { name: /^edit$/i }));
		await user.click(screen.getByRole("button", { name: /save changes/i }));
		await waitFor(() => expect(mockModelPatchUpdateCall).toHaveBeenCalled());
		expect(onModelUpdate).toHaveBeenLastCalledWith(expect.objectContaining(patchedModel));
		const payload = mockModelPatchUpdateCall.mock.calls[0][1] as { litellm_params: Record<string, unknown> };
		expect(payload.litellm_params.litellm_credential_name).toBe("reused-credential");
		expect(payload.litellm_params.litellm_credential_name).not.toBeNull();
	});

	it("does not request credential reuse before local model data is initialized", async () => {
		const createCredential = vi.fn();

		const attached = await attachCredentialToModel(
			"test-token",
			"123",
			null,
			{ credential_name: "stored-credential" },
			createCredential,
		);

		expect(attached).toBe(false);
		expect(createCredential).not.toHaveBeenCalled();
	});

	it("should display delete model button", async () => {
		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });
		await waitFor(() => {
			expect(screen.getByRole("button", { name: /delete model/i })).toBeInTheDocument();
		});
	});

	it("should disable delete button when model is not a DB model", async () => {
		const nonDbModelData = {
			...defaultModelData,
			model_info: {
				...defaultModelData.model_info,
				db_model: false,
			},
		};

		mockUseModelsInfo.mockReturnValue({
			data: {
				data: [nonDbModelData],
			},
			isLoading: false,
			error: null,
		});

		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });
		await waitFor(() => {
			const deleteButton = screen.getByRole("button", { name: /delete model/i });
			expect(deleteButton).toBeDisabled();
		});
	});

	it("should disable delete button when user is not admin and did not create the model", async () => {
		const nonCreatedByUserModelData = {
			...defaultModelData,
			model_info: {
				...defaultModelData.model_info,
				created_by: "456",
			},
		};

		mockUseModelsInfo.mockReturnValue({
			data: {
				data: [nonCreatedByUserModelData],
			},
			isLoading: false,
			error: null,
		});

		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} userRole="User" />, { wrapper });
		await waitFor(() => {
			const deleteButton = screen.getByRole("button", { name: /delete model/i });
			expect(deleteButton).toBeDisabled();
		});
	});

	it("should display overview and raw JSON tabs", async () => {
		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });
		await waitFor(() => {
			expect(screen.getByRole("tab", { name: /overview/i })).toBeInTheDocument();
			expect(screen.getByRole("tab", { name: /raw json/i })).toBeInTheDocument();
		});
	});

	it("should display model information in overview tab", async () => {
		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });
		await waitFor(() => {
			expect(screen.getByText("Provider")).toBeInTheDocument();
			expect(screen.getByText("LiteLLM Model")).toBeInTheDocument();
			expect(screen.getByText("Input / 1M")).toBeInTheDocument();
			expect(screen.getByText("Output / 1M")).toBeInTheDocument();
		});
	});

	it("should display edit settings button when user can edit model", async () => {
		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });
		await waitFor(() => {
			expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument();
		});
	});

	it("should not display edit settings button when model is not a DB model", async () => {
		const nonDbModelData = {
			...defaultModelData,
			model_info: {
				...defaultModelData.model_info,
				db_model: false,
			},
		};

		mockUseModelsInfo.mockReturnValue({
			data: {
				data: [nonDbModelData],
			},
			isLoading: false,
			error: null,
		});

		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });
		await waitFor(() => {
			expect(screen.queryByRole("button", { name: /^edit$/i })).not.toBeInTheDocument();
		});
	});

	it("should enter edit mode when edit settings button is clicked", async () => {
		const user = userEvent.setup();
		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });

		await waitFor(() => {
			expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument();
		});

		const editButton = screen.getByRole("button", { name: /^edit$/i });
		await user.click(editButton);

		await waitFor(() => {
			expect(document.querySelector(".ant-modal")).toBeInTheDocument();
			expect(document.querySelector(".ant-drawer")).toBeInTheDocument();
			expect(screen.getByText("Edit Model Settings")).toBeInTheDocument();
			expect(screen.getByRole("button", { name: /save changes/i })).toBeInTheDocument();
			expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
		});
	});

	it("echoes a manual API key in the form and preserves it on save", async () => {
		const user = userEvent.setup();
		const manualModelData = {
			...defaultModelData,
			litellm_params: {
				...defaultModelData.litellm_params,
				litellm_credential_name: "",
				api_key: "sk-existing",
			},
		};
		mockUseModelsInfo.mockReturnValue({ data: { data: [manualModelData] }, isLoading: false, error: null });

		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });
		await user.click(await screen.findByRole("button", { name: /^edit$/i }));

		const apiKeyInput = await screen.findByLabelText("Manual API Key");
		expect(apiKeyInput).toHaveValue("sk-existing");
		await user.click(screen.getByRole("button", { name: /save changes/i }));

		await waitFor(() => expect(mockModelPatchUpdateCall).toHaveBeenCalled());
		const payload = mockModelPatchUpdateCall.mock.calls[0][1] as { litellm_params: Record<string, unknown> };
		expect(payload.litellm_params.api_key).toBe("sk-existing");
		expect(payload.litellm_params.litellm_credential_name).toBeNull();
	});

	it("rotates or explicitly deletes a manual API key", async () => {
		const user = userEvent.setup();
		const manualModelData = {
			...defaultModelData,
			litellm_params: { ...defaultModelData.litellm_params, litellm_credential_name: "" },
		};
		mockUseModelsInfo.mockReturnValue({ data: { data: [manualModelData] }, isLoading: false, error: null });

		const { unmount } = render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });
		await user.click(await screen.findByRole("button", { name: /^edit$/i }));
		await user.type(await screen.findByLabelText("Manual API Key"), "replacement-key");
		await user.click(screen.getByRole("button", { name: /save changes/i }));
		await waitFor(() => expect(mockModelPatchUpdateCall).toHaveBeenCalled());
		let payload = mockModelPatchUpdateCall.mock.calls[0][1] as { litellm_params: Record<string, unknown> };
		expect(payload.litellm_params.api_key).toBe("replacement-key");

		unmount();
		vi.clearAllMocks();
		mockModelPatchUpdateCall.mockResolvedValue({});
		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });
		await user.click(await screen.findByRole("button", { name: /^edit$/i }));
		await user.click(await screen.findByLabelText("Delete stored manual API key"));
		await user.click(screen.getByRole("button", { name: /save changes/i }));
		await waitFor(() => expect(mockModelPatchUpdateCall).toHaveBeenCalled());
		payload = mockModelPatchUpdateCall.mock.calls[0][1] as { litellm_params: Record<string, unknown> };
		expect(payload.litellm_params.api_key).toBeNull();
	});

	it("should display form fields in edit mode", async () => {
		const user = userEvent.setup();
		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });

		await waitFor(() => {
			expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument();
		});

		const editButton = screen.getByRole("button", { name: /^edit$/i });
		await user.click(editButton);

		await waitFor(() => {
			expect(screen.getByPlaceholderText("Enter model name")).toBeInTheDocument();
			expect(screen.getByPlaceholderText("Enter LiteLLM model name")).toBeInTheDocument();
		});
	});

	it("uses a provider dropdown and saves CLIProxy without credentials or an API key", async () => {
		const user = userEvent.setup();
		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });

		await user.click(await screen.findByRole("button", { name: /^edit$/i }));
		await screen.findByText("Edit Model Settings");
		const providerSelect = await screen.findByRole("combobox", { name: "Custom LLM Provider" });
		const providerSelectTrigger = providerSelect.closest(".ant-select-selector");
		expect(providerSelectTrigger).not.toBeNull();

		await user.click(providerSelectTrigger as HTMLElement);
		expect(providerSelect).toHaveAttribute("aria-expanded", "true");
		const cliProxyOption = (await screen.findAllByRole("option", { hidden: true })).find(
			(option) => option.textContent?.trim() === "CLIProxy",
		);
		expect(cliProxyOption).toBeDefined();
		await user.click(cliProxyOption as HTMLElement);
		expect(await screen.findByText(/No API key is required/i)).toBeInTheDocument();
		expect(screen.queryByLabelText("Manual API Key")).not.toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: /save changes/i }));
		await waitFor(() => expect(mockModelPatchUpdateCall).toHaveBeenCalled());

		const payload = mockModelPatchUpdateCall.mock.calls[0][1] as { litellm_params: Record<string, unknown> };
		expect(payload.litellm_params).toMatchObject({
			custom_llm_provider: "cliproxy",
			api_base: null,
			api_key: null,
			litellm_credential_name: null,
		});
		expect(mockNotificationsManager.error).not.toHaveBeenCalledWith(
			"Enter a new API key before switching to Manual credentials",
		);
	});

	it("saves a model-level reasoning effort override", async () => {
		const user = userEvent.setup();
		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });

		await user.click(await screen.findByRole("button", { name: /^edit$/i }));
		const effortSelect = await screen.findByRole("combobox", { name: "Override Reasoning Effort" });
		await user.click(effortSelect.closest(".ant-select-selector") as HTMLElement);
		const xhighOption = await waitFor(() => {
			const option = document.querySelector<HTMLElement>('.ant-select-item-option[title="xhigh"]');
			expect(option).not.toBeNull();
			return option as HTMLElement;
		});
		await user.click(xhighOption);
		await user.click(screen.getByRole("button", { name: /save changes/i }));

		await waitFor(() => expect(mockModelPatchUpdateCall).toHaveBeenCalled());
		const payload = mockModelPatchUpdateCall.mock.calls[0][1] as { model_info: Record<string, unknown> };
		expect(payload.model_info.override_reasoning_effort).toBe("xhigh");
	});

	it("saves multiple model-level built-in capability selections", async () => {
		const user = userEvent.setup();
		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });

		await user.click(await screen.findByRole("button", { name: /^edit$/i }));
		await screen.findByText("Edit Model Settings");
		const capabilitySelect = await screen.findByRole("combobox", { name: "Injected Built-in Capabilities" });
		await user.click(capabilitySelect.closest(".ant-select-selector") as HTMLElement);
		const visionOption = await waitFor(() => {
			const option = document.querySelector<HTMLElement>('.ant-select-item-option[title="Vision"]');
			expect(option).not.toBeNull();
			return option as HTMLElement;
		});
		await user.click(visionOption);
		await user.click(screen.getByRole("button", { name: /save changes/i }));

		await waitFor(() => expect(mockModelPatchUpdateCall).toHaveBeenCalled());
		const payload = mockModelPatchUpdateCall.mock.calls[0][1] as { model_info: Record<string, unknown> };
		expect(payload.model_info.enabled_builtin_capabilities).toEqual(["vision"]);
	});

	it("should allow editing model name in edit mode", async () => {
		const user = userEvent.setup();
		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });

		await waitFor(() => {
			expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument();
		});

		const editButton = screen.getByRole("button", { name: /^edit$/i });
		await user.click(editButton);

		const modelNameInput = await screen.findByPlaceholderText("Enter model name");
		await user.clear(modelNameInput);
		await user.type(modelNameInput, "Updated Model Name");

		expect(modelNameInput).toHaveValue("Updated Model Name");
	});

	it("should cancel editing when cancel button is clicked", async () => {
		const user = userEvent.setup();
		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });

		await waitFor(() => {
			expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument();
		});

		const editButton = screen.getByRole("button", { name: /^edit$/i });
		await user.click(editButton);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
		});

		const cancelButton = screen.getByRole("button", { name: /cancel/i });
		await user.click(cancelButton);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument();
			expect(screen.queryByRole("button", { name: /save changes/i })).not.toBeInTheDocument();
		});
	});

	it("should save model changes when save button is clicked", async () => {
		const user = userEvent.setup();
		const mockOnModelUpdate = vi.fn();
		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} onModelUpdate={mockOnModelUpdate} />, { wrapper });

		await waitFor(() => {
			expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument();
		});

		const editButton = screen.getByRole("button", { name: /^edit$/i });
		await user.click(editButton);

		await waitFor(() => {
			expect(screen.getByRole("button", { name: /save changes/i })).toBeInTheDocument();
		});

		const saveButton = screen.getByRole("button", { name: /save changes/i });
		await user.click(saveButton);

		await waitFor(() => {
			expect(mockModelPatchUpdateCall).toHaveBeenCalled();
			expect(mockNotificationsManager.success).toHaveBeenCalledWith("Model settings updated successfully");
			expect(mockOnModelUpdate).toHaveBeenCalled();
		});
	});

	it("should display tags section", async () => {
		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });
		await waitFor(() => {
			expect(screen.getByText("Tags")).toBeInTheDocument();
		});
	});

	it("should display LiteLLM Params section", async () => {
		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });
		await waitFor(() => {
			expect(screen.getByText("LiteLLM Params")).toBeInTheDocument();
		});
	});

	it("should show existing credentials field in edit mode", async () => {
		const user = userEvent.setup();
		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });

		await waitFor(() => {
			expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument();
		});

		await user.click(screen.getByRole("button", { name: /^edit$/i }));

		await waitFor(() => {
			expect(screen.getAllByText("Existing Credentials")).toHaveLength(2);
			expect(document.querySelector(".ant-modal")).toBeInTheDocument();
		});
	});

	it("should keep selector credential and ignore litellm_credential_name from LiteLLM Params json", async () => {
		const user = userEvent.setup();
		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });

		await waitFor(() => {
			expect(screen.getByRole("button", { name: /^edit$/i })).toBeInTheDocument();
		});

		await user.click(screen.getByRole("button", { name: /^edit$/i }));

		const litellmParamsInput = screen
			.getAllByRole("textbox")
			.find(
				(input) =>
					input.tagName === "TEXTAREA" && (input as HTMLTextAreaElement).value.includes('"custom_llm_provider"'),
			);
		expect(litellmParamsInput).toBeDefined();
		if (!litellmParamsInput) {
			return;
		}
		expect((litellmParamsInput as HTMLTextAreaElement).value).not.toContain("litellm_credential_name");
		await user.clear(litellmParamsInput);
		await user.paste(`{"litellm_credential_name":"from-json","timeout":42}`);

		await user.click(screen.getByRole("button", { name: /save changes/i }));

		await waitFor(() => {
			expect(mockModelPatchUpdateCall).toHaveBeenCalled();
		});

		const updatePayload = mockModelPatchUpdateCall.mock.calls[0][1] as { litellm_params: Record<string, unknown> };
		expect(updatePayload.litellm_params.litellm_credential_name).toBe("selected-credential");
		expect(updatePayload.litellm_params.litellm_credential_name).not.toBe("from-json");
	});

	it("should display health check model field for wildcard models", async () => {
		const wildcardModelData = {
			...defaultModelData,
			litellm_params: {
				...defaultModelData.litellm_params,
				model: "openai/gpt-4*",
			},
		};

		mockUseModelsInfo.mockReturnValue({
			data: {
				data: [wildcardModelData],
			},
			isLoading: false,
			error: null,
		});

		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });
		await waitFor(() => {
			expect(screen.getByText("Health Check Model")).toBeInTheDocument();
		});
	});

	it("should not display health check model field for non-wildcard models", async () => {
		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });
		await waitFor(() => {
			expect(screen.getByText("Model Settings")).toBeInTheDocument();
			expect(screen.queryByText("Health Check Model")).not.toBeInTheDocument();
		});
	});

	it("should display edit auto router button for auto router models", async () => {
		const autoRouterModelData = {
			...defaultModelData,
			litellm_params: {
				...defaultModelData.litellm_params,
				auto_router_config: {},
			},
		};

		mockUseModelsInfo.mockReturnValue({
			data: {
				data: [autoRouterModelData],
			},
			isLoading: false,
			error: null,
		});

		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });
		await waitFor(() => {
			expect(screen.getByRole("button", { name: /edit auto router/i })).toBeInTheDocument();
		});
	});

	it("should display model access groups field", async () => {
		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });
		await waitFor(() => {
			expect(screen.getByText("Model Access Groups")).toBeInTheDocument();
		});
	});

	it("should display guardrails field", async () => {
		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });
		await waitFor(() => {
			expect(screen.getByText("Guardrails")).toBeInTheDocument();
		});
	});

	it("should display pricing information", async () => {
		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });
		await waitFor(() => {
			expect(screen.getByText("Input / 1M")).toBeInTheDocument();
			expect(screen.getByText("Output / 1M")).toBeInTheDocument();
		});
	});

	it("should display created at and created by information", async () => {
		render(<ModelInfoView {...DEFAULT_ADMIN_PROPS} />, { wrapper });
		await waitFor(() => {
			expect(screen.getByText(/Created At/)).toBeInTheDocument();
			expect(screen.getByText(/Created By/)).toBeInTheDocument();
		});
	});
});
