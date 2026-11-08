import { reactive } from "vue";
export interface CreatedKeyChoice {
	key_alias: string;
	token?: string;
}
const history = reactive(new Map<string, CreatedKeyChoice[]>());
/** The old shell offered only keys created in the current browser visit in its legacy customer filter. */
export function rememberCreatedKey(userId: string, response: Record<string, unknown>): void {
	if (typeof response.key_alias !== "string" || !response.key_alias) return;
	const choice: CreatedKeyChoice = { key_alias: response.key_alias };
	if (typeof response.token === "string") choice.token = response.token;
	history.set(userId, [...(history.get(userId) || []), choice]);
}
export function createdKeyChoices(userId: string): CreatedKeyChoice[] {
	return history.get(userId) || [];
}
