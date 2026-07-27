interface ModelValueListProps {
	value: unknown;
	emptyLabel: string;
	pillClassName: string;
}

export default function ModelValueList({ value, emptyLabel, pillClassName }: ModelValueListProps) {
	if (!Array.isArray(value)) return value ? String(value) : "Not Set";
	if (value.length === 0) return emptyLabel;

	return (
		<div className="flex flex-wrap gap-1">
			{value.map((item, index) => (
				<span
					key={`${String(item)}-${index}`}
					className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${pillClassName}`}
				>
					{String(item)}
				</span>
			))}
		</div>
	);
}
