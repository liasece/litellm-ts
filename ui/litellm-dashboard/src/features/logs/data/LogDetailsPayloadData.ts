import { logEntrySchema } from "../api/LogsSchemas";
import type { LogEntry } from "../support/LogsModels";

/** Validate without replacing stable nested references on every stream patch. */
export function assertLogDetailEntry(payload: unknown): asserts payload is LogEntry {
	logEntrySchema.parse(payload);
}

const patchSchema = logEntrySchema.partial();
export const isLogDetailPatch = (value: unknown): value is Record<string, unknown> => patchSchema.safeParse(value).success;
