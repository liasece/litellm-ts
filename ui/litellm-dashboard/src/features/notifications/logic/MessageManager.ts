import { messageStore } from "../stores/MessageStore";
export const messageManager = {
	success(content: string, duration?: number): void {
		messageStore.push("success", content, duration);
	},
	error(content: string, duration?: number): void {
		messageStore.push("error", content, duration);
	},
	warning(content: string, duration?: number): void {
		messageStore.push("warning", content, duration);
	},
	info(content: string, duration?: number): void {
		messageStore.push("info", content, duration);
	},
	loading(content: string, duration?: number) {
		return messageStore.push("loading", content, duration);
	},
	destroy(): void {
		messageStore.clear();
	},
};
export default messageManager;
