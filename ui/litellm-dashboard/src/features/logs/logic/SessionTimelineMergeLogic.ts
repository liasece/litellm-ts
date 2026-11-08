import type { SessionTimelineResponse, SessionTimelineUpdate } from "../support/SessionTimelineModels";
export function applySessionTimelineUpdate(
	previous: SessionTimelineResponse | undefined,
	update: SessionTimelineUpdate,
): SessionTimelineResponse {
	const byId = new Map((previous?.data ?? []).map((event) => [event.id, event]));
	for (const event of update.upsert) byId.set(event.id, event);
	for (const id of update.removed ?? []) byId.delete(id);
	const previousOrder = (previous?.data ?? []).map((event) => event.id).filter((id) => byId.has(id));
	const appendedOrder = update.upsert.map((event) => event.id).filter((id) => !previousOrder.includes(id));
	const data = (update.order ?? [...previousOrder, ...appendedOrder]).flatMap((id) => {
		const event = byId.get(id);
		return event ? [event] : [];
	});
	return {
		data,
		summary: update.summary,
		active_requests: update.active_requests,
		...(previous?.window ? { window: previous.window } : {}),
	};
}
export function safeSessionError(error: unknown, fallback: string, limit = 300): string {
	const message = error instanceof Error ? error.message : fallback;
	return /^\s*(?:<!doctype\s+html|<html)\b/i.test(message) ? fallback : message.slice(0, limit);
}
