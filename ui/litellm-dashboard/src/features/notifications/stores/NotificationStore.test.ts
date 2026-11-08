import { afterEach, describe, expect, it, vi } from "vitest";
import { createNotificationStore, notificationStore } from "./NotificationStore";
import notificationManager, { receiveNotificationEvent } from "../logic/NotificationManager";
afterEach(() => {
	notificationStore.clear();
	vi.useRealTimers();
});
describe("original notification behavior", () => {
	it("keeps each notification type's original duration and title", () => {
		vi.useFakeTimers();
		notificationManager.error("failed");
		notificationManager.warning("check");
		notificationManager.info("loading");
		notificationManager.success("saved");
		expect(notificationStore.notices.map(({ type, duration, message }) => ({ type, duration, message }))).toEqual([
			{ type: "success", duration: 3.5, message: "Success" },
			{ type: "info", duration: 4, message: "Info" },
			{ type: "warning", duration: 5, message: "Warning" },
			{ type: "error", duration: 6, message: "Error" },
		]);
		vi.advanceTimersByTime(3500);
		expect(notificationStore.notices.map((notice) => notice.type)).toEqual(["info", "warning", "error"]);
		vi.advanceTimersByTime(2500);
		expect(notificationStore.notices).toHaveLength(0);
	});
	it("pauses a notice on hover and resumes only the remaining duration", () => {
		vi.useFakeTimers();
		const store = createNotificationStore({ now: () => Date.now() });
		const id = store.push("error", { message: "Error", description: "fixture", duration: 6 });
		vi.advanceTimersByTime(2000);
		store.pause(id);
		vi.advanceTimersByTime(10000);
		expect(store.notices).toHaveLength(1);
		expect(store.notices[0].remaining).toBe(4000);
		store.resume(id);
		vi.advanceTimersByTime(3999);
		expect(store.notices).toHaveLength(1);
		vi.advanceTimersByTime(1);
		expect(store.notices).toHaveLength(0);
		store.clear();
	});
	it("replaces keyed notices, supports persistent notices and closes explicitly", () => {
		vi.useFakeTimers();
		const store = createNotificationStore();
		const id = store.push("info", { key: "operation", message: "Info", description: "pending", duration: 4 });
		store.push("success", { key: "operation", message: "Success", description: "saved", duration: 0 });
		expect(store.notices).toHaveLength(1);
		expect(store.notices[0].id).toBe(id);
		vi.advanceTimersByTime(60000);
		expect(store.notices[0].description).toBe("saved");
		store.close(id);
		expect(store.notices).toHaveLength(0);
	});
	it("retains backend classification and bridges the existing application event", () => {
		vi.useFakeTimers();
		notificationManager.fromBackend("invalid api key");
		expect(notificationStore.notices[0]).toMatchObject({ type: "error", message: "Authentication Error", duration: 6 });
		notificationManager.fromBackend("budget exceeded");
		expect(notificationStore.notices[0]).toMatchObject({ type: "warning", message: "Budget Exceeded", duration: 7 });
		notificationManager.fromBackend({ response: { status: 500, data: { error: { message: "upstream failure" } } } });
		expect(notificationStore.notices[0]).toMatchObject({ type: "error", message: "Server Error", duration: 8 });
		receiveNotificationEvent({ detail: { type: "success", message: "Exported fixture" } } as unknown as Event);
		expect(notificationStore.notices[0]).toMatchObject({
			type: "success",
			message: "Success",
			description: "Exported fixture",
			duration: 3.5,
		});
	});
});
