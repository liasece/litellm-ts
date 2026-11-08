import { requestJson, HttpApiError } from "../../platform/api/HttpApiClient";
import notifications from "../../notifications/logic/NotificationManager";
export async function withUsageReadFeedback<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
	try {
		return await operation();
	} catch (error: unknown) {
		if (!signal?.aborted && error instanceof HttpApiError) notifications.fromBackend(error.message);
		throw error;
	}
}

export function usageRequestJson<T = unknown>(path: string, init: RequestInit = {}, parse?: (payload: unknown) => T): Promise<T> {
	return withUsageReadFeedback(() => requestJson(path, init, parse), init.signal ?? undefined);
}
