/* @vitest-environment jsdom */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ModelsAndEndpointsView from "./ModelsAndEndpointsView";

const navigationMocks = vi.hoisted(() => ({
  replace: vi.fn(),
  search: "page=models",
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/ui/",
  useRouter: () => ({ replace: navigationMocks.replace }),
  useSearchParams: () => new URLSearchParams(navigationMocks.search),
}));

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();
Object.defineProperty(window, "localStorage", { value: localStorageMock });

// Minimal stubs to avoid Next.js router and network usage during render
vi.mock("@/components/networking", () => ({
  credentialListCall: vi.fn().mockResolvedValue({ credentials: [] }),
  modelInfoCall: vi.fn().mockResolvedValue({ data: [] }),
  modelCostMap: vi.fn().mockResolvedValue({}),
  getPassThroughEndpointsCall: vi.fn().mockResolvedValue({ endpoints: {} }),
  getCallbacksCall: vi.fn().mockResolvedValue({ router_settings: {} }),
  setCallbacksCall: vi.fn().mockResolvedValue(undefined),
  getUiSettings: vi.fn().mockResolvedValue({ values: {} }),
  latestHealthChecksCall: vi.fn().mockResolvedValue({ latest_health_checks: {} }),
  getModelCostMapReloadStatus: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/app/(dashboard)/models-and-endpoints/components/ModelAnalyticsTab/ModelAnalyticsTab", () => ({
  default: () => null,
}));

vi.mock("@/components/add_model/add_auto_router_tab", () => ({
  default: () => null,
}));

vi.mock("@/components/add_model/AddModelForm", () => ({
  default: () => null,
}));

const mockHealthCheckComponent = vi.fn((_props: { all_models_on_proxy?: string[] }) => null);
vi.mock("@/components/model_dashboard/HealthCheckComponent", () => ({
  default: (props: { all_models_on_proxy?: string[] }) => {
    mockHealthCheckComponent(props);
    return null;
  },
}));

vi.mock("@/app/(dashboard)/hooks/useTeams", () => ({
  default: () => ({
    teams: [],
    setTeams: vi.fn(),
  }),
}));

const mockUseModelsInfo = vi.fn();
vi.mock("@/app/(dashboard)/hooks/models/useModels", () => ({
  useModelsInfo: (...args: unknown[]) => mockUseModelsInfo(...args),
}));

const mockUseUISettings = vi.fn();
vi.mock("@/app/(dashboard)/hooks/uiSettings/useUISettings", () => ({
  useUISettings: () => mockUseUISettings(),
}));

const mockUseModelCostMap = vi.fn();
vi.mock("@/app/(dashboard)/hooks/models/useModelCostMap", () => ({
  useModelCostMap: (enabled: boolean = true, refreshWhenEnabled: boolean = false) =>
    mockUseModelCostMap(enabled, refreshWhenEnabled),
}));

const mockUseCredentials = vi.fn();
vi.mock("@/app/(dashboard)/hooks/credentials/useCredentials", () => ({
  useCredentials: (enabled: boolean = true) => mockUseCredentials(enabled),
}));

const mockUseAuthorized = vi.fn();
vi.mock("@/app/(dashboard)/hooks/useAuthorized", () => ({
  default: () => mockUseAuthorized(),
}));

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });

describe("ModelsAndEndpointsView", () => {
  beforeEach(() => {
    navigationMocks.search = "page=models";
    navigationMocks.replace.mockReset();
    navigationMocks.replace.mockImplementation((url: string) => {
      navigationMocks.search = url.split("?")[1] || "";
    });
    mockUseModelsInfo.mockReturnValue({
      data: { data: [] },
      isLoading: false,
      refetch: vi.fn(),
    });
    mockUseUISettings.mockReturnValue({
      data: { values: {} },
    });
    mockUseModelCostMap.mockReturnValue({
      data: {},
      isLoading: false,
      error: null,
    });
    mockUseCredentials.mockReturnValue({
      data: { credentials: [] },
      isLoading: false,
      refetch: vi.fn(),
    });
    mockUseAuthorized.mockReturnValue({
      accessToken: "123",
      token: "123",
      userRole: "Admin",
      userId: "123",
    });
    (global as any).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

  it("should render the models and endpoints view", async () => {
    const queryClient = createQueryClient();
    const { findByText } = render(
      <QueryClientProvider client={queryClient}>
        <ModelsAndEndpointsView
          token="123"
          modelData={{ data: [] }}
          keys={[]}
          setModelData={() => {}}
          premiumUser={false}
          teams={[]}
        />
      </QueryClientProvider>,
    );
    expect(await findByText("Model Management", {}, { timeout: 10000 })).toBeInTheDocument();
  }, 15000);

  it("should omit the Missing provider banner and keep the Request Provider action", async () => {
    localStorageMock.clear();
    const queryClient = createQueryClient();
    const { findByText, queryByText } = render(
      <QueryClientProvider client={queryClient}>
        <ModelsAndEndpointsView
          token="123"
          modelData={{ data: [] }}
          keys={[]}
          setModelData={() => {}}
          premiumUser={false}
          teams={[]}
        />
      </QueryClientProvider>,
    );

    await findByText("Model Management", {}, { timeout: 10000 });

    expect(queryByText("Missing a provider?")).not.toBeInTheDocument();
    expect(document.querySelectorAll('a[href="https://models.litellm.ai/?request=true"]')).toHaveLength(1);
  }, 15000);

  it("should pass model IDs (not model names) to HealthCheckComponent as all_models_on_proxy", async () => {
    mockHealthCheckComponent.mockClear();
    const modelDataWithIds = {
      data: [
        { model_name: "gpt-4", model_info: { id: "deployment-id-1" } },
        { model_name: "gpt-4", model_info: { id: "deployment-id-2" } },
      ],
    };
    mockUseModelsInfo.mockReturnValue({
      data: { data: modelDataWithIds.data },
      isLoading: false,
      refetch: vi.fn(),
    });

    const queryClient = createQueryClient();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <ModelsAndEndpointsView
          token="123"
          modelData={{ data: modelDataWithIds.data }}
          keys={[]}
          setModelData={() => {}}
          premiumUser={false}
          teams={[]}
        />
      </QueryClientProvider>,
    );

    const healthStatusTab = view.getByRole("tab", { name: "Health Status" });
    await act(async () => {
      healthStatusTab.click();
    });
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <ModelsAndEndpointsView
          token="123"
          modelData={{ data: modelDataWithIds.data }}
          keys={[]}
          setModelData={() => {}}
          premiumUser={false}
          teams={[]}
        />
      </QueryClientProvider>,
    );

    expect(mockHealthCheckComponent).toHaveBeenCalled();
    const healthCheckProps = mockHealthCheckComponent.mock.calls[0][0];
    expect(healthCheckProps.all_models_on_proxy).toEqual(["deployment-id-1", "deployment-id-2"]);
    expect(healthCheckProps.all_models_on_proxy).not.toContain("gpt-4");
  });

  it("stores the selected tab in the URL and only enables tab-specific queries after navigation", async () => {
    const queryClient = createQueryClient();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <ModelsAndEndpointsView
          token="123"
          modelData={{ data: [] }}
          keys={[]}
          setModelData={() => {}}
          premiumUser={false}
          teams={[]}
        />
      </QueryClientProvider>,
    );

    expect(mockUseCredentials).toHaveBeenLastCalledWith(false);

    await act(async () => {
      view.getByRole("tab", { name: "LLM Credentials" }).click();
    });

    expect(navigationMocks.replace).toHaveBeenCalledWith("/ui/?page=models&tab=credentials", { scroll: false });

    view.rerender(
      <QueryClientProvider client={queryClient}>
        <ModelsAndEndpointsView
          token="123"
          modelData={{ data: [] }}
          keys={[]}
          setModelData={() => {}}
          premiumUser={false}
          teams={[]}
        />
      </QueryClientProvider>,
    );

    expect(mockUseCredentials).toHaveBeenCalledWith(true);
  });

  it("restores the active tab from the URL on refresh", () => {
    navigationMocks.search = "page=models&tab=health";
    const modelDataWithIds = {
      data: [{ model_name: "gpt-4", model_info: { id: "deployment-id-1" } }],
    };
    mockUseModelsInfo.mockReturnValue({
      data: modelDataWithIds,
      isLoading: false,
      refetch: vi.fn(),
    });

    const queryClient = createQueryClient();
    const { getByRole } = render(
      <QueryClientProvider client={queryClient}>
        <ModelsAndEndpointsView
          token="123"
          modelData={{ data: [] }}
          keys={[]}
          setModelData={() => {}}
          premiumUser={false}
          teams={[]}
        />
      </QueryClientProvider>,
    );

    expect(getByRole("tab", { name: "Health Status" })).toHaveAttribute("aria-selected", "true");
    expect(mockHealthCheckComponent).toHaveBeenCalled();
  });

  it("preserves a requested tab while authorization is still loading", () => {
    navigationMocks.search = "page=models&tab=health";
    mockUseAuthorized.mockReturnValue({
      accessToken: "",
      token: null,
      userRole: null,
      userId: null,
    });

    const queryClient = createQueryClient();
    const view = render(
      <QueryClientProvider client={queryClient}>
        <ModelsAndEndpointsView
          token={null}
          modelData={{ data: [] }}
          keys={[]}
          setModelData={() => {}}
          premiumUser={false}
          teams={null}
        />
      </QueryClientProvider>,
    );

    expect(navigationMocks.replace).not.toHaveBeenCalled();

    mockUseAuthorized.mockReturnValue({
      accessToken: "123",
      token: "123",
      userRole: "Admin",
      userId: "123",
    });
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <ModelsAndEndpointsView
          token="123"
          modelData={{ data: [] }}
          keys={[]}
          setModelData={() => {}}
          premiumUser={false}
          teams={[]}
        />
      </QueryClientProvider>,
    );

    expect(view.getByRole("tab", { name: "Health Status" })).toHaveAttribute("aria-selected", "true");
  });
});
