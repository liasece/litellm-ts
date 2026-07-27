import { Text } from "@tremor/react";

interface PublicCodeExampleProps {
	title: string;
	code: string;
	onCopy: (value: string) => void;
	compact?: boolean;
}

export default function PublicCodeExample({ title, code, onCopy, compact = false }: PublicCodeExampleProps) {
	return (
		<div>
			<Text className={compact ? "mb-2 text-sm font-medium text-gray-700" : "mb-4 text-lg font-semibold"}>{title}</Text>
			<div className="overflow-x-auto rounded-lg bg-gray-900 p-4 text-gray-100">
				<pre className={compact ? "text-xs" : "text-sm"}>{code}</pre>
			</div>
			<div className="mt-2 text-right">
				<button
					type="button"
					onClick={() => onCopy(code)}
					className="cursor-pointer text-sm text-blue-600 hover:text-blue-800"
				>
					Copy to clipboard
				</button>
			</div>
		</div>
	);
}
