import type { KeyDraft } from "./VirtualKeyModels";
import type { UiSelectOption } from "../../platform/ui/UiTypes";

export type TextKeyField = Exclude<{ [K in keyof KeyDraft]: KeyDraft[K] extends string ? K : never }[keyof KeyDraft], "owner">;
export type NumericKeyField = "max_budget" | "tpm_limit" | "rpm_limit" | "max_parallel_requests";
export type ListKeyField = { [K in keyof KeyDraft]: KeyDraft[K] extends string[] ? K : never }[keyof KeyDraft];
export type BooleanKeyField = { [K in keyof KeyDraft]: KeyDraft[K] extends boolean ? K : never }[keyof KeyDraft];
interface FieldBase {
	label: string;
	tooltip?: string;
	tooltipHref?: string;
	help?: string;
	disabled?: boolean;
	required?: boolean;
	placeholder?: string;
	width?: number;
	tremor?: boolean;
}
export type KeyField =
	| (FieldBase & { name: TextKeyField; kind: "text" | "textarea" })
	| (FieldBase & { name: NumericKeyField; kind: "number"; step?: number; precision?: number })
	| (FieldBase & { name: TextKeyField; kind: "select"; options: readonly UiSelectOption[]; clearable?: boolean })
	| (FieldBase & { name: ListKeyField; kind: "multiple"; options: readonly UiSelectOption[]; creatable?: boolean })
	| (FieldBase & { name: BooleanKeyField; kind: "switch" });
