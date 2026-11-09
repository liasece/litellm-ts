import type { CodeInterpreterResult } from "../support/PlaygroundModels";
import { asRecord, string } from "./PlaygroundValueLogic";
export interface InterpreterState {
	code: string;
	containerId: string;
}
export function processCodeInterpreter(
	event: Record<string, unknown>,
	state: InterpreterState,
	callback?: (result: CodeInterpreterResult) => void,
): InterpreterState {
	const item = asRecord(event.item);
	if (event.type !== "response.output_item.done" || item?.type !== "code_interpreter_call") return state;
	const next = { code: string(item.code) ?? "", containerId: string(item.container_id) ?? "" };
	if (next.code) callback?.(next);
	return next;
}
