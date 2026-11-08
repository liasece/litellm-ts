export type MessageKind = "success" | "error" | "warning" | "info" | "loading";
export interface MessageEntry {
	id: number;
	type: MessageKind;
	content: string;
	duration: number;
}
export type MessageClose = (() => void) & PromiseLike<boolean>;
