import { inject, reactive, type InjectionKey } from "vue";
import { fetchExchangeRates } from "../logic/ExchangeRatesService";
import {
	DEFAULT_PRICE_SETTINGS,
	formatPrice,
	validateSource,
	type ExchangeRates,
	type ModelPriceIdentity,
	type PriceDisplaySettings,
} from "../logic/PriceDisplayLogic";

export * from "../logic/PriceDisplayLogic";

const STORAGE_KEY = "litellm-price-display-v1";
const REFRESH_INTERVAL = 3600000;
export interface PriceDisplayState {
	settings: PriceDisplaySettings;
	exchange: ExchangeRates | null;
	error: string | null;
	initialized: boolean;
	loading: boolean;
}

function readSettings(storage?: Pick<Storage, "getItem">): PriceDisplaySettings {
	try {
		const parsed: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) || "null");
		if (!parsed || typeof parsed !== "object") return { ...DEFAULT_PRICE_SETTINGS, modelCurrencies: {} };
		const settings = parsed as Partial<PriceDisplaySettings>;
		if (
			!settings.currency ||
			!/^[A-Z]{3}$/.test(settings.currency) ||
			!settings.modelCurrencies ||
			typeof settings.modelCurrencies !== "object" ||
			!settings.source
		)
			return { ...DEFAULT_PRICE_SETTINGS, modelCurrencies: {} };
		validateSource(settings.source);
		return {
			currency: settings.currency,
			source: settings.source,
			modelCurrencies: Object.fromEntries(
				Object.entries(settings.modelCurrencies).filter(
					(entry): entry is [string, string] => typeof entry[1] === "string" && /^[A-Z]{3}$/.test(entry[1]),
				),
			),
		};
	} catch {
		return { ...DEFAULT_PRICE_SETTINGS, modelCurrencies: {} };
	}
}

interface PriceDisplayOptions {
	storage?: Pick<Storage, "getItem" | "setItem">;
	fetchRates?: typeof fetchExchangeRates;
}

export function createPriceDisplayStore(options: PriceDisplayOptions = {}) {
	const state = reactive<PriceDisplayState>({
		settings: { ...DEFAULT_PRICE_SETTINGS, modelCurrencies: {} },
		exchange: null,
		error: null,
		initialized: false,
		loading: false,
	});
	let storage = options.storage;
	let generation = 0;
	let timer: ReturnType<typeof setInterval> | null = null;
	let pending: Promise<void> | null = null;
	let disposed = false;
	const fetchRates = options.fetchRates ?? fetchExchangeRates;

	async function refresh(): Promise<void> {
		if (pending) return pending;
		const current = generation;
		const source = state.settings.source;
		state.loading = true;
		const request = (async () => {
			let lastError: unknown;
			for (let attempt = 0; attempt < 2; attempt++) {
				try {
					const exchange = await fetchRates(source);
					if (!disposed && generation === current && source === state.settings.source) {
						state.exchange = exchange;
						state.error = null;
					}
					return;
				} catch (error: unknown) {
					lastError = error;
				}
			}
			if (lastError && !disposed && generation === current && source === state.settings.source) {
				state.exchange = null;
				state.error = "汇率加载失败，请检查数据源或网络；缺失汇率时不会显示错误金额。";
			}
		})().finally(() => {
			if (!disposed && generation === current) state.loading = false;
			if (pending === request) pending = null;
		});
		pending = request;
		return request;
	}
	function sync(): void {
		const settings = readSettings(storage);
		const changedSource = state.settings.source !== settings.source;
		state.settings = settings;
		if (changedSource) {
			generation++;
			state.exchange = null;
			pending = null;
		}
		if (changedSource && state.initialized) void refresh();
	}
	async function initialize(): Promise<void> {
		if (state.initialized) return;
		if (!storage) {
			try {
				storage = typeof window === "undefined" ? undefined : window.localStorage;
			} catch {
				/* Storage can be unavailable. */
			}
		}
		sync();
		state.initialized = true;
		if (typeof window !== "undefined") {
			window.addEventListener("storage", sync);
			timer = setInterval(() => void refresh(), REFRESH_INTERVAL);
		}
		await refresh();
	}
	function save(settings: PriceDisplaySettings): void {
		validateSource(settings.source);
		const changedSource = state.settings.source !== settings.source;
		state.settings = { ...settings, modelCurrencies: { ...settings.modelCurrencies } };
		state.error = null;
		storage?.setItem(STORAGE_KEY, JSON.stringify(settings));
		if (changedSource) {
			generation++;
			state.exchange = null;
			pending = null;
			if (state.initialized) void refresh();
		}
	}
	function format(value: number | string | null | undefined, decimals: number | "compact" = 4, model?: ModelPriceIdentity): string {
		return formatPrice(value, state.settings, state.exchange, decimals, model);
	}
	function dispose(): void {
		disposed = true;
		generation++;
		if (timer !== null) clearInterval(timer);
		if (typeof window !== "undefined") window.removeEventListener("storage", sync);
	}
	return { state, initialize, save, refresh, format, dispose };
}

export type PriceDisplayStore = ReturnType<typeof createPriceDisplayStore>;
export const priceDisplayStoreKey: InjectionKey<PriceDisplayStore> = Symbol("PriceDisplayStore");
export function usePriceDisplayStore(): PriceDisplayStore {
	const store = inject(priceDisplayStoreKey);
	if (!store) throw new Error("PriceDisplayStore is not provided");
	return store;
}
export function useMoneyFormatter(): PriceDisplayStore["format"] {
	return usePriceDisplayStore().format;
}
