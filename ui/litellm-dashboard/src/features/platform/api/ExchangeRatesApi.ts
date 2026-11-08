import { parseExchangeRates, validateSource, type ExchangeRates } from "../support/PriceDisplaySupport";

export async function fetchExchangeRates(source: string, request: typeof fetch = globalThis.fetch): Promise<ExchangeRates> {
	validateSource(source);
	let response: Response;
	try {
		response = await request(source, {
			credentials: "omit",
			referrerPolicy: "no-referrer",
			signal: AbortSignal.timeout(10000),
		});
	} catch {
		throw new Error("汇率请求超时或网络不可用，请检查数据源地址及跨域支持");
	}
	if (!response.ok) throw new Error("汇率请求失败（HTTP " + response.status + "）");
	return parseExchangeRates(await response.json(), source);
}
