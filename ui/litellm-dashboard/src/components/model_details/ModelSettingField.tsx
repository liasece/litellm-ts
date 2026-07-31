import { Text } from "@tremor/react";
import type { ReactNode } from "react";

interface ModelSettingFieldProps {
	label: ReactNode;
	editing: boolean;
	editor: ReactNode;
	children: ReactNode;
	fullWidth?: boolean;
}

function isUnset(value: ReactNode): boolean {
	return value === null || value === undefined || value === "" || value === "Not Set";
}

export default function ModelSettingField({ label, editing, editor, children, fullWidth = false }: ModelSettingFieldProps) {
	return (
		<div className={`min-w-0 border-b border-gray-100 px-3 py-2 ${fullWidth ? "lg:col-span-2" : ""}`}>
			<Text className="mb-1 text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</Text>
			{editing ? (
				editor
			) : isUnset(children) ? (
				<div className="text-sm text-gray-300">-</div>
			) : (
				<div className="min-w-0 break-words text-sm text-gray-800">{children}</div>
			)}
		</div>
	);
}
