import { Button } from "@tremor/react";

interface PromptsToolbarProps {
	disabled: boolean;
	onCreate: () => void;
	onUpload: () => void;
}

export default function PromptsToolbar({
	disabled,
	onCreate,
	onUpload,
}: PromptsToolbarProps) {
	return (
		<div className="mb-4 flex items-center justify-between">
			<div className="flex gap-2">
				<Button onClick={onCreate} disabled={disabled}>
					+ Add New Prompt
				</Button>
				<Button onClick={onUpload} disabled={disabled} variant="secondary">
					Upload .prompt File
				</Button>
			</div>
		</div>
	);
}

