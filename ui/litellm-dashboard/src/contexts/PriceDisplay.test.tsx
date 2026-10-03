import { act, render, screen, waitFor, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { Money, PriceDisplayProvider, savePriceDisplaySettings } from "./PriceDisplay";
import { DEFAULT_PRICE_SETTINGS } from "@/utils/priceDisplay";
import { ModelCurrencySetting } from "@/components/PriceDisplaySettings";

afterEach(() => {
	act(() => savePriceDisplaySettings(DEFAULT_PRICE_SETTINGS));
	localStorage.clear();
	vi.unstubAllGlobals();
});
it("汇率加载、切换全局和模型偏好立即刷新现有金额，不改输入值或发送写请求", async () => {
	const fetcher = vi.fn().mockResolvedValue({
		ok: true,
		json: async () => [
			{ base: "USD", quote: "CNY", rate: 7, date: new Date().toISOString().slice(0, 10) },
			{ base: "USD", quote: "EUR", rate: 0.9, date: new Date().toISOString().slice(0, 10) },
		],
	});
	vi.stubGlobal("fetch", fetcher);
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<PriceDisplayProvider>
				<Money value={2} decimals={2} model="one" />
				<input aria-label="计费输入 USD" defaultValue="2" />
				<ModelCurrencySetting modelId="one" />
			</PriceDisplayProvider>
		</QueryClientProvider>,
	);
	expect(screen.getByText("$2.00")).toBeInTheDocument();
	await waitFor(() => expect(fetcher).toHaveBeenCalled());
	act(() => savePriceDisplaySettings({ ...DEFAULT_PRICE_SETTINGS, currency: "CNY" }));
	await screen.findByText("CNY 14.00");
	act(() => savePriceDisplaySettings({ ...DEFAULT_PRICE_SETTINGS, currency: "CNY", modelCurrencies: { one: "EUR" } }));
	expect(screen.getByText("EUR 1.80")).toBeInTheDocument();
	expect(screen.getByLabelText("计费输入 USD")).toHaveValue("2");
	fireEvent.mouseDown(screen.getByRole("combobox"));
	fireEvent.click(screen.getAllByText("跟随系统").at(-1)!);
	expect(screen.getByText("CNY 14.00")).toBeInTheDocument();
	expect(fetcher.mock.calls.every(([, options]) => !options.method || options.method === "GET")).toBe(true);
	client.clear();
});
