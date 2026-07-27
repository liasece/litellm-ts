import { Text } from "@tremor/react";
import type { ReactNode } from "react";

interface KeyValueListProps {
	values: unknown;
	empty: ReactNode;
}

export default function KeyValueList({ values, empty }: KeyValueListProps) {
	return (
		<div className="mt-1 flex flex-wrap gap-2">
			{Array.isArray(values) && values.length > 0
				? values.map((value) => (
						<span key={String(value)} className="rounded bg-blue-100 px-2 py-1 text-xs">
							{String(value)}
						</span>
					))
				: empty}
		</div>
	);
}

export function EmptyKeyValueList({ children }: { children: ReactNode }) {
	return <Text>{children}</Text>;
}
