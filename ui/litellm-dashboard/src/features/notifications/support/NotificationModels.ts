import type { VNode } from "vue";
export type NotificationKind = "success" | "error" | "info" | "warning";
export type NotificationPlacement = "top" | "topLeft" | "topRight" | "bottom" | "bottomLeft" | "bottomRight";
export type NotificationContent = string | VNode;
export interface NotificationConfig {
	message?: NotificationContent;
	description?: NotificationContent;
	duration?: number;
	placement?: NotificationPlacement;
	key?: string;
}
export interface NotificationEntry {
	id: number;
	key?: string;
	type: NotificationKind;
	message: NotificationContent;
	description?: NotificationContent;
	duration: number;
	remaining: number;
	placement: NotificationPlacement;
	paused: boolean;
}
export const notificationPlacements: NotificationPlacement[] = ["top", "topLeft", "topRight", "bottom", "bottomLeft", "bottomRight"];
