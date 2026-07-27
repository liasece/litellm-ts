import { ChevronDownIcon, ChevronRightIcon } from "@heroicons/react/outline";
import { Badge, Icon, Text } from "@tremor/react";
import { useState } from "react";
import { getModelDisplayName } from "../../key_team_helpers/fetch_available_models_team_key";

interface OrganizationModelsCellProps {
	models: string[];
}

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

export default function OrganizationModelsCell({ models }: OrganizationModelsCellProps) {
	const [expanded, setExpanded] = useState(false);

	if (models.length === 0) {
		return (
			<Badge size="xs" className="mb-1" color="red">
				<Text>All Proxy Models</Text>
			</Badge>
		);
	}

	const visibleModels = expanded ? models : models.slice(0, 3);

	return (
		<div className="flex items-start">
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
					<Badge size="xs" color="gray" className="cursor-pointer" onClick={() => setExpanded(true)}>
						<Text>
							+{models.length - 3} {models.length - 3 === 1 ? "more model" : "more models"}
						</Text>
					</Badge>
				)}
			</div>
		</div>
	);
}
