import { Text } from "@tremor/react";
import type { ReactNode } from "react";

interface ModelSettingFieldProps {
	label: ReactNode;
	editing: boolean;
	editor: ReactNode;
	children: ReactNode;
}

export default function ModelSettingField({ label, editing, editor, children }: ModelSettingFieldProps) {
	return (
		<div>
			<Text className="font-medium">{label}</Text>
			{editing ? editor : <div className="mt-1 rounded bg-gray-50 p-2">{children}</div>}
		</div>
	);
}
