import { z } from "zod";
import type { CodeInterpreterResult } from "../support/PlaygroundModels";
import { asRecord, records, string } from "./PlaygroundValueLogic";
const annotation = z.object({
	type: z.literal("container_file_citation"),
	container_id: z.string(),
	file_id: z.string(),
	filename: z.string(),
	start_index: z.number(),
	end_index: z.number(),
});
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
	if (event.type !== "response.output_item.done" || !item) return state;
	if (item.type === "code_interpreter_call") return { code: string(item.code) ?? "", containerId: string(item.container_id) ?? "" };
	if (item.type === "message" && callback)
		for (const part of records(item.content)) {
			if (part.type !== "output_text" || !Array.isArray(part.annotations)) continue;
			const annotations = part.annotations.flatMap((raw) => {
				const parsed = annotation.safeParse(raw);
				return parsed.success ? [parsed.data] : [];
			});
			if (annotations.length || state.code) callback({ ...state, annotations });
		}
	return state;
}
