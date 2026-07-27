import { getModelDisplayName } from "@/components/key_team_helpers/fetch_available_models_team_key";
import { ChevronDownIcon, ChevronRightIcon } from "@heroicons/react/outline";
import { Badge, Icon, Text } from "@tremor/react";
import { useState } from "react";

function ModelBadge({ model }: { model: string }) {
	if (model === "all-proxy-models") {
		return (
			<Badge size="xs" color="red">
				<Text>All Proxy Models</Text>
			</Badge>
		);
	}

	const displayName = getModelDisplayName(model);
	return (
		<Badge size="xs" color="blue">
			<Text>{displayName.length > 30 ? `${displayName.slice(0, 30)}...` : displayName}</Text>
		</Badge>
	);
}

export default function VirtualKeyModelsCell({ models }: { models: string[] }) {
	const [expanded, setExpanded] = useState(false);

	if (!Array.isArray(models)) return null;
	if (models.length === 0) {
		return (
			<Badge size="xs" color="red">
				<Text>All Proxy Models</Text>
			</Badge>
		);
	}

	const visibleModels = expanded ? models : models.slice(0, 3);
	return (
		<div className="flex items-start py-2">
			{models.length > 3 && (
				<Icon
					icon={expanded ? ChevronDownIcon : ChevronRightIcon}
					className="cursor-pointer"
					size="xs"
					onClick={() => setExpanded((value) => !value)}
				/>
			)}
			<div className="flex flex-wrap gap-1">
				{visibleModels.map((model, index) => (
					<ModelBadge key={`${model}-${index}`} model={model} />
				))}
				{models.length > 3 && !expanded && (
					<Badge size="xs" color="gray" className="cursor-pointer">
						<Text>
							+{models.length - 3} {models.length === 4 ? "more model" : "more models"}
						</Text>
					</Badge>
				)}
			</div>
		</div>
	);
}
