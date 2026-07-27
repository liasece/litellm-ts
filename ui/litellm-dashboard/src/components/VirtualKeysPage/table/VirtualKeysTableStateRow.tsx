import { TableCell, TableRow } from "@tremor/react";

export default function VirtualKeysTableStateRow({
	columnCount,
	message,
}: {
	columnCount: number;
	message: string;
}) {
	return (
		<TableRow>
			<TableCell colSpan={columnCount} className="h-8 text-center">
				<p className="text-center text-gray-500">{message}</p>
			</TableCell>
		</TableRow>
	);
}

