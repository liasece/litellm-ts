export const DEFAULT_RATE_SOURCE = "https://api.frankfurter.dev/v1/latest?base=USD";

export interface PriceDisplaySettings {
	currency: string;
	modelCurrencies: Record<string, string>;
	source: string;
}
export interface ExchangeRates {
	rates: Record<string, number>;
	date: string;
	fetchedAt: number;
	source: string;
}
export const DEFAULT_PRICE_SETTINGS: PriceDisplaySettings = {
	currency: "USD",
	modelCurrencies: {},
	source: DEFAULT_RATE_SOURCE,
};

export function validateSource(source: string): string {
	const url = new URL(source);
	if (url.protocol !== "https:" || url.username || url.password || url.hash) {
		throw new Error("汇率源必须是不含凭据的 HTTPS 地址");
	}
	return url.toString();
}

export function parseExchangeRates(data: unknown, source: string, now = Date.now()): ExchangeRates {
	const rates: Record<string, number> = { USD: 1 };
	let date = "";
	const add = (code: unknown, rate: unknown, day: unknown) => {
		if (
			typeof code !== "string" ||
			!/^[A-Z]{3}$/.test(code.toUpperCase()) ||
			typeof rate !== "number" ||
			!Number.isFinite(rate) ||
			rate <= 0 ||
			typeof day !== "string" ||
			!/^\d{4}-\d{2}-\d{2}$/.test(day) ||
			!Number.isFinite(Date.parse(day)) ||
			Date.parse(day) > now + 86400000
		) {
			throw new Error("汇率源返回了无效币种、汇率或日期");
		}
		rates[code.toUpperCase()] = rate;
		if (!date || day < date) date = day;
	};
	if (Array.isArray(data)) {
		for (const row of data) {
			if (!row || String(row.base).toUpperCase() !== "USD") throw new Error("汇率基准必须为 USD");
			add(row.quote, row.rate, row.date);
		}
	} else if (data && typeof data === "object") {
		const obj = data as Record<string, unknown>;
		if (String(obj.base).toUpperCase() !== "USD" || !obj.rates || typeof obj.rates !== "object") {
			throw new Error("汇率基准必须为 USD，并包含 rates");
		}
		for (const [code, rate] of Object.entries(obj.rates)) add(code, rate, obj.date);
	} else throw new Error("无法识别汇率响应");
	if (!date || Object.keys(rates).length < 2 || rates.USD !== 1) throw new Error("汇率数据不完整");
	if (now - Date.parse(date) > 10 * 86400000) throw new Error("汇率数据已超过 10 天");
	return { rates, date, fetchedAt: now, source };
}

export type ModelPriceIdentity =
	| string
	| { model_id?: string; model_name?: string; model_group?: string; model?: string; model_info?: { id?: string } };
export function targetCurrency(settings: PriceDisplaySettings, model?: ModelPriceIdentity): string {
	const keys =
		typeof model === "string"
			? [model]
			: model
				? [model.model_info?.id, model.model_id, model.model_name, model.model_group, model.model]
				: [];
	for (const key of keys)
		if (key && Object.prototype.hasOwnProperty.call(settings.modelCurrencies, key) && settings.modelCurrencies[key])
			return settings.modelCurrencies[key];
	return settings.currency;
}

export function formatPrice(
	value: number | string | null | undefined,
	settings: PriceDisplaySettings,
	exchange: ExchangeRates | null,
	decimals: number | "compact" = 4,
	model?: ModelPriceIdentity,
	now = Date.now(),
): string {
	if (value == null || value === "" || !Number.isFinite(Number(value))) return "-";
	const currency = targetCurrency(settings, model);
	const rate =
		currency === "USD"
			? 1
			: exchange?.source === settings.source && now - Date.parse(exchange.date) <= 10 * 86400000
				? exchange.rates[currency]
				: undefined;
	if (!rate) return `— (${currency} 汇率不可用)`;
	const amount = Number(value) * rate;
	if (!Number.isFinite(amount)) return "-";
	const symbol = currency === "USD" ? "$" : currency + " ";
	if (decimals === "compact") {
		const magnitude = Math.abs(amount);
		if (magnitude >= 1000000)
			return symbol + (amount / 1000000).toLocaleString("en-US", { maximumFractionDigits: 6 }) + "M";
		if (magnitude >= 1000) return symbol + (amount / 1000).toLocaleString("en-US", { maximumFractionDigits: 6 }) + "k";
		if (magnitude === 0 || magnitude >= 0.000001)
			return symbol + amount.toLocaleString("en-US", { maximumFractionDigits: 6 });
		decimals = 6;
	}
	const options = { minimumFractionDigits: decimals, maximumFractionDigits: decimals };
	if (amount !== 0 && Math.abs(amount) < 10 ** -decimals) {
		return `${amount < 0 ? "> -" : "< "}${symbol}${(10 ** -decimals).toFixed(decimals)}`;
	}
	return symbol + amount.toLocaleString("en-US", options);
}
