import { notificationManager } from "../../notifications/logic/NotificationManager";
export function copyHubText(value: string) {
	void navigator.clipboard.writeText(value);
	notificationManager.success("Copied to clipboard!");
}
