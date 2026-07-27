import { Button } from "antd";
import { CheckIcon, CopyIcon } from "lucide-react";
import { Text, Title } from "@tremor/react";

interface GuardrailDetailsHeaderProps {
	name: string | null | undefined;
	id: string;
	copied: boolean;
	onCopy: () => void;
}

export default function GuardrailDetailsHeader({
	name,
	id,
	copied,
	onCopy,
}: GuardrailDetailsHeaderProps) {
	return (
		<div>
			<Title>{name || "Unnamed Guardrail"}</Title>
			<div className="flex cursor-pointer items-center">
				<Text className="font-mono text-gray-500">{id}</Text>
				<Button
					type="text"
					size="small"
					icon={copied ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
					onClick={onCopy}
					className={`left-2 z-10 transition-all duration-200 ${
						copied
							? "border-green-200 bg-green-50 text-green-600"
							: "text-gray-500 hover:bg-gray-100 hover:text-gray-700"
					}`}
				/>
			</div>
		</div>
	);
}
