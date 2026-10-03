"use client";

import { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import {
	DEFAULT_PRICE_SETTINGS,
	ExchangeRates,
	PriceDisplaySettings,
	ModelPriceIdentity,
	formatPrice,
	parseExchangeRates,
	validateSource,
} from "@/utils/priceDisplay";

const STORAGE_KEY = "litellm-price-display-v1";
interface Snapshot {
	settings: PriceDisplaySettings;
	exchange: ExchangeRates | null;
	error: string | null;
	initialized: boolean;
}
const initial: Snapshot = { settings: DEFAULT_PRICE_SETTINGS, exchange: null, error: null, initialized: false };
let snapshot = initial;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
};
const publish = (next: Snapshot) => {
	snapshot = next;
	listeners.forEach((listener) => listener());
};
export function usePriceDisplay() {
	return useSyncExternalStore(
		subscribe,
		() => snapshot,
		() => initial,
	);
}
export function useMoneyFormatter() {
	const state = usePriceDisplay();
	return useCallback(
		(value: number | string | null | undefined, decimals: number | "compact" = 4, model?: ModelPriceIdentity) =>
			formatPrice(value, state.settings, state.exchange, decimals, model),
		[state],
	);
}
export function formatMoney(
	value: number | string | null | undefined,
	decimals: number | "compact" = 4,
	model?: ModelPriceIdentity,
): string {
	return formatPrice(value, snapshot.settings, snapshot.exchange, decimals, model);
}
const ModelPriceContext = createContext<ModelPriceIdentity | undefined>(undefined);
export function ModelPriceScope({ model, children }: { model: ModelPriceIdentity; children: React.ReactNode }) {
	return <ModelPriceContext.Provider value={model}>{children}</ModelPriceContext.Provider>;
}
export function Money({
	value,
	decimals = 4,
	model,
}: {
	value: number | string | null | undefined;
	decimals?: number;
	model?: ModelPriceIdentity;
}) {
	const state = usePriceDisplay();
	const inheritedModel = useContext(ModelPriceContext);
	return <>{formatPrice(value, state.settings, state.exchange, decimals, model ?? inheritedModel)}</>;
}
export function savePriceDisplaySettings(settings: PriceDisplaySettings) {
	validateSource(settings.source);
	const next = {
		...snapshot,
		settings,
		exchange: settings.source === snapshot.settings.source ? snapshot.exchange : null,
		error: null,
	};
	localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
	publish(next);
}
function readSettings(): PriceDisplaySettings {
	try {
		const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
		if (
			!parsed ||
			!/^[A-Z]{3}$/.test(parsed.currency) ||
			typeof parsed.modelCurrencies !== "object" ||
			!parsed.modelCurrencies
		)
			return DEFAULT_PRICE_SETTINGS;
		validateSource(parsed.source);
		return {
			currency: parsed.currency,
			source: parsed.source,
			modelCurrencies: Object.fromEntries(
				Object.entries(parsed.modelCurrencies).filter(
					(entry): entry is [string, string] => typeof entry[1] === "string" && /^[A-Z]{3}$/.test(entry[1]),
				),
			),
		};
	} catch {
		return DEFAULT_PRICE_SETTINGS;
	}
}
export async function fetchExchangeRates(source: string): Promise<ExchangeRates> {
	validateSource(source);
	let response: Response;
	try {
		response = await fetch(source, {
			credentials: "omit",
			referrerPolicy: "no-referrer",
			signal: AbortSignal.timeout(10000),
		});
	} catch {
		throw new Error("汇率请求超时或网络不可用，请检查数据源地址及跨域支持");
	}
	if (!response.ok) throw new Error(`汇率请求失败（HTTP ${response.status}）`);
	return parseExchangeRates(await response.json(), source);
}
export function PriceDisplayProvider({ children }: { children: React.ReactNode }) {
	const { settings, initialized } = usePriceDisplay();
	const rates = useQuery({
		enabled: initialized,
		queryKey: ["display-exchange-rates", settings.source],
		queryFn: () => fetchExchangeRates(settings.source),
		staleTime: 3600000,
		refetchInterval: 3600000,
		retry: 1,
	});
	useEffect(() => {
		const sync = () => {
			const settings = readSettings();
			publish({
				...snapshot,
				initialized: true,
				settings,
				exchange: snapshot.exchange?.source === settings.source ? snapshot.exchange : null,
			});
		};
		sync();
		window.addEventListener("storage", sync);
		return () => window.removeEventListener("storage", sync);
	}, []);
	useEffect(() => {
		publish({
			...snapshot,
			exchange: rates.data ?? null,
			error: rates.error ? "汇率加载失败，请检查数据源或网络；缺失汇率时不会显示错误金额。" : null,
		});
	}, [rates.data, rates.error]);
	return <>{children}</>;
}
