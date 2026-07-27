import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchAvailableModelsForTeamOrKey } from "./key_team_helpers/fetch_available_models_team_key";
import { fetchMCPAccessGroups, getGuardrailsList, teamCreateCall } from "./networking";
import OldTeams from "./OldTeams";

const mockTeamInfoView = vi.fn();
const mockUseOrganizations = vi.fn();

vi.mock("./networking", () => ({
	teamCreateCall: vi.fn(),
	teamDeleteCall: vi.fn(),
	fetchMCPAccessGroups: vi.fn(),
	v2TeamListCall: vi.fn(),
	getGuardrailsList: vi.fn().mockResolvedValue({ guardrails: [] }),
	getPoliciesList: vi.fn().mockResolvedValue({ policies: [] }),
}));

vi.mock("@/app/(dashboard)/hooks/teams/useTeams", () => ({
	teamListCall: vi.fn().mockResolvedValue({ teams: [], total: 0, page: 1, page_size: 100, total_pages: 0 }),
}));

vi.mock("./molecules/notifications_manager", () => ({
	default: {
		info: vi.fn(),
		success: vi.fn(),
		error: vi.fn(),
		fromBackend: vi.fn(),
	},
}));

vi.mock("./key_team_helpers/fetch_available_models_team_key", () => ({
	fetchAvailableModelsForTeamOrKey: vi.fn(),
	getModelDisplayName: vi.fn((model: string) => model),
	unfurlWildcardModelsInList: vi.fn((teamModels: string[], allModels: string[]) => {
		const wildcardDisplayNames: string[] = [];
		const expandedModels: string[] = [];

		teamModels.forEach((teamModel) => {
			if (teamModel.endsWith("/*")) {
				const provider = teamModel.replace("/*", "");
				const matchingModels = allModels.filter((model) => model.startsWith(provider + "/"));
				expandedModels.push(...matchingModels);
				wildcardDisplayNames.push(teamModel);
			} else {
				expandedModels.push(teamModel);
			}
		});

		return [...wildcardDisplayNames, ...expandedModels].filter((item, index, array) => array.indexOf(item) === index);
	}),
}));

vi.mock("@/components/team/TeamInfo", () => ({
	__esModule: true,
	default: (props: any) => {
		mockTeamInfoView(props);
		return <div data-testid="team-info-view" />;
	},
}));

vi.mock("./ModelSelect/ModelSelect", () => {
	const ModelSelect = React.forwardRef(({ value, onChange, dataTestId, id }: any, ref: any) => {
		return (
			<input
				ref={ref}
				id={id}
				type="text"
				data-testid={dataTestId || "model-select"}
				value={Array.isArray(value) ? value.join(", ") : ""}
				onChange={(e) => {
					if (onChange) {
						const newVal = e.target.value
							? e.target.value
									.split(",")
									.map((s: string) => s.trim())
									.filter(Boolean)
							: [];
						onChange(newVal);
					}
				}}
			/>
		);
	});
	ModelSelect.displayName = "ModelSelect";
	return {
		ModelSelect,
	};
});

vi.mock("@/app/(dashboard)/hooks/organizations/useOrganizations", () => ({
	useOrganizations: () => mockUseOrganizations(),
}));

vi.mock("@/app/(dashboard)/hooks/accessGroups/useAccessGroups", () => ({
	useAccessGroups: vi.fn().mockReturnValue({
		data: [
			{ access_group_id: "ag-1", access_group_name: "Group 1" },
			{ access_group_id: "ag-2", access_group_name: "Group 2" },
		],
		isLoading: false,
		isError: false,
	}),
}));

vi.mock("./common_components/AccessGroupSelector", () => ({
	default: ({ value = [], onChange }: { value?: string[]; onChange?: (v: string[]) => void }) => (
		<input
			data-testid="access-group-selector"
			value={Array.isArray(value) ? value.join(",") : ""}
			onChange={(e) => onChange?.(e.target.value ? e.target.value.split(",").map((s) => s.trim()) : [])}
		/>
	),
}));

const createQueryClient = () => {
	return new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
			},
		},
	});
};

const renderWithQueryClient = (component: React.ReactElement) => {
	const queryClient = createQueryClient();
	return render(<QueryClientProvider client={queryClient}>{component}</QueryClientProvider>);
};

describe("OldTeams - interactions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockTeamInfoView.mockClear();
		vi.mocked(fetchAvailableModelsForTeamOrKey).mockResolvedValue([]);
		vi.mocked(fetchMCPAccessGroups).mockResolvedValue([]);
		vi.mocked(getGuardrailsList).mockResolvedValue({ guardrails: [] });
		mockUseOrganizations.mockReturnValue({ data: null });
	});

	it("should clear the delete modal when the cancel button is clicked", async () => {
		mockUseOrganizations.mockReturnValue({ data: [] });
		renderWithQueryClient(
			<OldTeams
				teams={[
					{
						team_id: "1",
						team_alias: "Test Team",
						organization_id: "org-123",
						models: ["gpt-4"],
						max_budget: 100,
						budget_duration: "1d",
						tpm_limit: 1000,
						rpm_limit: 1000,
						created_at: new Date().toISOString(),
						keys: [],
						members_with_roles: [],
						spend: 0,
					},
				]}
				searchParams={{}}
				accessToken="test-token"
				setTeams={vi.fn()}
				userID="user-123"
				userRole="Admin"
				organizations={[]}
			/>,
		);
		await waitFor(() => {
			expect(screen.getByTestId("delete-team-button")).toBeInTheDocument();
		});
		const deleteTeamButton = screen.getByTestId("delete-team-button");
		act(() => {
			fireEvent.click(deleteTeamButton);
		});
		expect(screen.getByText("Delete Team?")).toBeInTheDocument();
	});
});

describe("OldTeams - empty state", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockUseOrganizations.mockReturnValue({ data: [] });
	});

	it("should display empty state message when teams array is empty", async () => {
		renderWithQueryClient(
			<OldTeams
				teams={[]}
				searchParams={{}}
				accessToken="test-token"
				setTeams={vi.fn()}
				userID="user-123"
				userRole="Admin"
				organizations={[]}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByText("No teams yet")).toBeInTheDocument();
		});
		expect(
			screen.getByText("Create your first team to organize members and manage access to models."),
		).toBeInTheDocument();
	});

	it("should display empty state message when teams is null", async () => {
		renderWithQueryClient(
			<OldTeams
				teams={null}
				searchParams={{}}
				accessToken="test-token"
				setTeams={vi.fn()}
				userID="user-123"
				userRole="Admin"
				organizations={[]}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByText("No teams yet")).toBeInTheDocument();
		});
		expect(
			screen.getByText("Create your first team to organize members and manage access to models."),
		).toBeInTheDocument();
	});

	it("should not display empty state when teams array has items", async () => {
		renderWithQueryClient(
			<OldTeams
				teams={[
					{
						team_id: "1",
						team_alias: "Test Team",
						organization_id: "org-123",
						models: ["gpt-4"],
						max_budget: 100,
						budget_duration: "1d",
						tpm_limit: 1000,
						rpm_limit: 1000,
						created_at: new Date().toISOString(),
						keys: [],
						members_with_roles: [],
						spend: 0,
					},
				]}
				searchParams={{}}
				accessToken="test-token"
				setTeams={vi.fn()}
				userID="user-123"
				userRole="Admin"
				organizations={[]}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByText("Test Team")).toBeInTheDocument();
		});
		expect(screen.queryByText("No teams yet")).not.toBeInTheDocument();
		expect(
			screen.queryByText("Create your first team to organize members and manage access to models."),
		).not.toBeInTheDocument();
	});
});

describe("OldTeams - premium props", () => {
	beforeEach(() => {
		mockTeamInfoView.mockClear();
		vi.mocked(fetchAvailableModelsForTeamOrKey).mockResolvedValue([]);
		vi.mocked(fetchMCPAccessGroups).mockResolvedValue([]);
		vi.mocked(getGuardrailsList).mockResolvedValue({ guardrails: [] });
		mockUseOrganizations.mockReturnValue({ data: [] });
	});

	it("passes premiumUser flag to TeamInfoView", async () => {
		renderWithQueryClient(
			<OldTeams
				teams={[
					{
						team_id: "team-123456789",
						team_alias: "Premium Team",
						organization_id: "org-123",
						models: ["gpt-4"],
						max_budget: 100,
						budget_duration: "1d",
						tpm_limit: 1000,
						rpm_limit: 1000,
						created_at: new Date().toISOString(),
						keys: [],
						members_with_roles: [],
						spend: 0,
					},
				]}
				searchParams={{}}
				accessToken="test-token"
				setTeams={vi.fn()}
				userID="user-123"
				userRole="Admin"
				organizations={[]}
				premiumUser={true}
			/>,
		);

		const teamIdElement = await screen.findByText("team-123456789");
		act(() => {
			fireEvent.click(teamIdElement);
		});

		await waitFor(() => expect(mockTeamInfoView).toHaveBeenCalled());

		expect(mockTeamInfoView).toHaveBeenLastCalledWith(expect.objectContaining({ premiumUser: true }));
	});
});

describe("OldTeams - Default Team Settings tab visibility", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockUseOrganizations.mockReturnValue({ data: [] });
	});

	it("should show Default Team Settings tab for Admin role", () => {
		renderWithQueryClient(
			<OldTeams
				teams={[
					{
						team_id: "1",
						team_alias: "Test Team",
						organization_id: "org-123",
						models: ["gpt-4"],
						max_budget: 100,
						budget_duration: "1d",
						tpm_limit: 1000,
						rpm_limit: 1000,
						created_at: new Date().toISOString(),
						keys: [],
						members_with_roles: [],
						spend: 0,
					},
				]}
				searchParams={{}}
				accessToken="test-token"
				setTeams={vi.fn()}
				userID="user-123"
				userRole="Admin"
				organizations={[]}
			/>,
		);

		expect(screen.getByRole("tab", { name: "Default Team Settings" })).toBeInTheDocument();
	});

	it("should show Default Team Settings tab for proxy_admin role", () => {
		renderWithQueryClient(
			<OldTeams
				teams={[
					{
						team_id: "1",
						team_alias: "Test Team",
						organization_id: "org-123",
						models: ["gpt-4"],
						max_budget: 100,
						budget_duration: "1d",
						tpm_limit: 1000,
						rpm_limit: 1000,
						created_at: new Date().toISOString(),
						keys: [],
						members_with_roles: [],
						spend: 0,
					},
				]}
				searchParams={{}}
				accessToken="test-token"
				setTeams={vi.fn()}
				userID="user-123"
				userRole="proxy_admin"
				organizations={[]}
			/>,
		);

		expect(screen.getByRole("tab", { name: "Default Team Settings" })).toBeInTheDocument();
	});

	it("should not show Default Team Settings tab for proxy_admin_viewer role", () => {
		renderWithQueryClient(
			<OldTeams
				teams={[
					{
						team_id: "1",
						team_alias: "Test Team",
						organization_id: "org-123",
						models: ["gpt-4"],
						max_budget: 100,
						budget_duration: "1d",
						tpm_limit: 1000,
						rpm_limit: 1000,
						created_at: new Date().toISOString(),
						keys: [],
						members_with_roles: [],
						spend: 0,
					},
				]}
				searchParams={{}}
				accessToken="test-token"
				setTeams={vi.fn()}
				userID="user-123"
				userRole="proxy_admin_viewer"
				organizations={[]}
			/>,
		);

		expect(screen.queryByRole("tab", { name: "Default Team Settings" })).not.toBeInTheDocument();
	});

	it("should not show Default Team Settings tab for Admin Viewer role", () => {
		renderWithQueryClient(
			<OldTeams
				teams={[
					{
						team_id: "1",
						team_alias: "Test Team",
						organization_id: "org-123",
						models: ["gpt-4"],
						max_budget: 100,
						budget_duration: "1d",
						tpm_limit: 1000,
						rpm_limit: 1000,
						created_at: new Date().toISOString(),
						keys: [],
						members_with_roles: [],
						spend: 0,
					},
				]}
				searchParams={{}}
				accessToken="test-token"
				setTeams={vi.fn()}
				userID="user-123"
				userRole="Admin Viewer"
				organizations={[]}
			/>,
		);

		expect(screen.queryByRole("tab", { name: "Default Team Settings" })).not.toBeInTheDocument();
	});
});

describe("OldTeams - access_group_ids in team create", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockTeamInfoView.mockClear();
		vi.mocked(fetchAvailableModelsForTeamOrKey).mockResolvedValue(["gpt-4", "gpt-3.5-turbo"]);
		vi.mocked(fetchMCPAccessGroups).mockResolvedValue([]);
		vi.mocked(getGuardrailsList).mockResolvedValue({ guardrails: [] });
		vi.mocked(teamCreateCall).mockResolvedValue({
			team_id: "new-team-1",
			team_alias: "Test Team",
			models: ["gpt-4"],
			organization_id: null,
			keys: [],
			members_with_roles: [],
			spend: 0,
		} as any);
		mockUseOrganizations.mockReturnValue({
			data: [{ organization_id: "org-1", organization_alias: "Org 1", models: [], members: [] }],
		});
	});

	it(
		"should pass access_group_ids to teamCreateCall when creating team",
		async () => {
			renderWithQueryClient(
				<OldTeams
					teams={[]}
					searchParams={{}}
					accessToken="test-token"
					setTeams={vi.fn()}
					userID="user-123"
					userRole="Admin"
					organizations={[{ organization_id: "org-1", organization_alias: "Org 1", models: [], members: [] }]}
				/>,
			);

			const createButton = screen.getAllByRole("button", { name: /create team/i })[0];
			act(() => {
				fireEvent.click(createButton);
			});

			await waitFor(() => {
				expect(screen.getByLabelText(/team name/i)).toBeInTheDocument();
			});

			const teamNameInput = screen.getByLabelText(/team name/i);
			fireEvent.change(teamNameInput, { target: { value: "Test Team" } });

			const modelsInput = screen.getByTestId("create-team-models-select");
			fireEvent.change(modelsInput, { target: { value: "gpt-4" } });

			const additionalSettingsAccordion = screen.getByText("Additional Settings");
			fireEvent.click(additionalSettingsAccordion);

			await waitFor(() => {
				expect(screen.getByTestId("access-group-selector")).toBeInTheDocument();
			});

			const accessGroupInput = screen.getByTestId("access-group-selector");
			fireEvent.change(accessGroupInput, { target: { value: "ag-1,ag-2" } });

			const createTeamSubmitButtons = screen.getAllByRole("button", { name: /create team/i });
			const createTeamSubmitButton = createTeamSubmitButtons[createTeamSubmitButtons.length - 1];
			fireEvent.click(createTeamSubmitButton);

			await waitFor(() => {
				expect(teamCreateCall).toHaveBeenCalledWith(
					"test-token",
					expect.objectContaining({
						team_alias: "Test Team",
						models: ["gpt-4"],
						access_group_ids: ["ag-1", "ag-2"],
					}),
				);
			});
		},
		{ timeout: 30000 },
	);
});

describe("OldTeams - models dropdown options", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(fetchAvailableModelsForTeamOrKey).mockResolvedValue(["gpt-4", "gpt-3.5-turbo"]);
		mockUseOrganizations.mockReturnValue({ data: [] });
	});

	it("should not render all-proxy-models option in models select", async () => {
		vi.mocked(fetchAvailableModelsForTeamOrKey).mockResolvedValue(["gpt-4", "gpt-3.5-turbo"]);

		renderWithQueryClient(
			<OldTeams
				teams={[]}
				searchParams={{}}
				accessToken="test-token"
				setTeams={vi.fn()}
				userID="user-123"
				userRole="Admin"
				organizations={[]}
			/>,
		);

		await waitFor(() => {
			expect(fetchAvailableModelsForTeamOrKey).toHaveBeenCalled();
		});

		const createButton = screen.getAllByRole("button", { name: /create team/i })[0];
		act(() => {
			fireEvent.click(createButton);
		});

		await waitFor(() => {
			expect(screen.getByLabelText(/models/i)).toBeInTheDocument();
		});
		const allProxyModelsOption = screen.queryByText("All Proxy Models");
		expect(allProxyModelsOption).not.toBeInTheDocument();
	});
});

describe("OldTeams - organization alias display", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockUseOrganizations.mockReturnValue({ data: [] });
	});

	it("should display organization alias instead of organization id", async () => {
		const mockOrganizations = [
			{
				organization_id: "org-123",
				organization_alias: "Test Organization",
				budget_id: "budget-1",
				metadata: {},
				models: [],
				spend: 0,
				model_spend: {},
				created_at: new Date().toISOString(),
				created_by: "user-1",
				updated_at: new Date().toISOString(),
				updated_by: "user-1",
				litellm_budget_table: null,
				teams: null,
				users: null,
				members: null,
			},
		];

		mockUseOrganizations.mockReturnValue({ data: mockOrganizations });

		renderWithQueryClient(
			<OldTeams
				teams={[
					{
						team_id: "1",
						team_alias: "Test Team",
						organization_id: "org-123",
						models: ["gpt-4"],
						max_budget: 100,
						budget_duration: "1d",
						tpm_limit: 1000,
						rpm_limit: 1000,
						created_at: new Date().toISOString(),
						keys: [],
						members_with_roles: [],
						spend: 0,
					},
				]}
				searchParams={{}}
				accessToken="test-token"
				setTeams={vi.fn()}
				userID="user-123"
				userRole="Admin"
				organizations={mockOrganizations}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByText("Test Organization")).toBeInTheDocument();
		});
		expect(screen.queryByText("org-123")).not.toBeInTheDocument();
	});

	it("should display organization id when alias is not found", async () => {
		mockUseOrganizations.mockReturnValue({ data: [] });

		renderWithQueryClient(
			<OldTeams
				teams={[
					{
						team_id: "1",
						team_alias: "Test Team",
						organization_id: "org-unknown",
						models: ["gpt-4"],
						max_budget: 100,
						budget_duration: "1d",
						tpm_limit: 1000,
						rpm_limit: 1000,
						created_at: new Date().toISOString(),
						keys: [],
						members_with_roles: [],
						spend: 0,
					},
				]}
				searchParams={{}}
				accessToken="test-token"
				setTeams={vi.fn()}
				userID="user-123"
				userRole="Admin"
				organizations={[]}
			/>,
		);

		await waitFor(() => {
			expect(screen.getByText("org-unknown")).toBeInTheDocument();
		});
	});

	it("should display N/A when organization_id is null", async () => {
		mockUseOrganizations.mockReturnValue({ data: [] });

		renderWithQueryClient(
			<OldTeams
				teams={[
					{
						team_id: "1",
						team_alias: "Test Team",
						organization_id: null as any,
						models: ["gpt-4"],
						max_budget: 100,
						budget_duration: "1d",
						tpm_limit: 1000,
						rpm_limit: 1000,
						created_at: new Date().toISOString(),
						keys: [],
						members_with_roles: [],
						spend: 0,
					},
				]}
				searchParams={{}}
				accessToken="test-token"
				setTeams={vi.fn()}
				userID="user-123"
				userRole="Admin"
				organizations={[]}
			/>,
		);

		await waitFor(() => {
			// When organization_id is null, the table shows "—" in the Organization column
			expect(screen.getAllByText("—").length).toBeGreaterThan(0);
		});
	});
});
