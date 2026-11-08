import { reactive } from "vue";
import notificationManager from "../../notifications/logic/NotificationManager";
import { HttpApiError } from "../../platform/api/HttpApiClient";
import { costTrackingApi, type CostTrackingApi } from "../api/CostTrackingApi";
import { addDiscount, addMargin } from "../logic/CostTrackingLogic";
import type { AddMarginParams, DiscountConfig, MarginConfig, MarginValue } from "../support/CostTrackingModels";
export function createCostTrackingStore(api: CostTrackingApi = costTrackingApi) {
	const state = reactive({ discounts: {} as DiscountConfig, margins: {} as MarginConfig, models: [] as string[], loading: true });
	let disposed = false,
		generation = 0;
	async function loadDiscounts() {
		try {
			const value = await api.discounts();
			if (!disposed) state.discounts = value;
		} catch (error: unknown) {
			if (!(error instanceof HttpApiError)) notificationManager.fromBackend("Failed to fetch discount configuration");
		}
	}
	async function loadMargins() {
		try {
			const value = await api.margins();
			if (!disposed) state.margins = value;
		} catch (error: unknown) {
			if (!(error instanceof HttpApiError)) notificationManager.fromBackend("Failed to fetch margin configuration");
		}
	}
	async function initialize() {
		const current = ++generation;
		state.loading = true;
		void api
			.models()
			.then((value) => {
				if (!disposed && current === generation) state.models = value;
			})
			.catch(() => undefined);
		await Promise.all([loadDiscounts(), loadMargins()]);
		if (!disposed && current === generation) state.loading = false;
	}
	async function saveDiscounts(config: DiscountConfig) {
		state.discounts = config;
		try {
			await api.saveDiscounts(config);
			if (!disposed) {
				notificationManager.success("Discount configuration updated successfully");
				await loadDiscounts();
			}
		} catch (error: unknown) {
			if (!disposed)
				notificationManager.fromBackend(error instanceof HttpApiError ? error.message : "Failed to update discount configuration");
		}
	}
	async function saveMargins(config: MarginConfig) {
		state.margins = config;
		try {
			await api.saveMargins(config);
			if (!disposed) {
				notificationManager.success("Margin configuration updated successfully");
				await loadMargins();
			}
		} catch (error: unknown) {
			if (!disposed)
				notificationManager.fromBackend(error instanceof HttpApiError ? error.message : "Failed to update margin configuration");
		}
	}
	async function createDiscount(provider: string | undefined, text: string) {
		try {
			const change = addDiscount(state.discounts, provider, text);
			await saveDiscounts({ ...state.discounts, [change.provider]: change.value });
			return true;
		} catch (error: unknown) {
			notificationManager.fromBackend(error instanceof Error ? error.message : String(error));
			return false;
		}
	}
	async function createMargin(params: AddMarginParams) {
		try {
			const change = addMargin(state.margins, params);
			await saveMargins({ ...state.margins, [change.provider]: change.value });
			return true;
		} catch (error: unknown) {
			notificationManager.fromBackend(error instanceof Error ? error.message : String(error));
			return false;
		}
	}
	async function removeDiscount(provider: string) {
		const config = { ...state.discounts };
		delete config[provider];
		await saveDiscounts(config);
	}
	async function removeMargin(provider: string) {
		const config = { ...state.margins };
		delete config[provider];
		await saveMargins(config);
	}
	async function changeDiscount(provider: string, text: string) {
		const value = Number.parseFloat(text);
		if (!Number.isNaN(value) && value >= 0 && value <= 1) await saveDiscounts({ ...state.discounts, [provider]: value });
	}
	async function changeMargin(provider: string, value: MarginValue) {
		await saveMargins({ ...state.margins, [provider]: value });
	}
	function dispose() {
		disposed = true;
		generation++;
	}
	return { state, initialize, createDiscount, createMargin, removeDiscount, removeMargin, changeDiscount, changeMargin, dispose };
}
