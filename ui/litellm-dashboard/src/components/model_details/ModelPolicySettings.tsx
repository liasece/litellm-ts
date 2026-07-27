import { InfoCircleOutlined } from "@ant-design/icons";
import { Form, Select, Tooltip } from "antd";
import VectorStoreSelector from "../vector_store_management/VectorStoreSelector";
import { Tag } from "../tag_management/types";
import ModelSettingField from "./ModelSettingField";
import ModelValueList from "./ModelValueList";

interface ModelPolicySettingsProps {
	editing: boolean;
	modelData: any;
	accessToken: string | null;
	guardrails: string[];
	tags: Record<string, Tag>;
}

function DocumentationLabel({
	label,
	tooltip,
	href,
}: {
	label: string;
	tooltip: string;
	href: string;
}) {
	return (
		<>
			{label}
			<Tooltip title={tooltip}>
				<a href={href} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>
					<InfoCircleOutlined style={{ marginLeft: 4 }} />
				</a>
			</Tooltip>
		</>
	);
}

export default function ModelPolicySettings({
	editing,
	modelData,
	accessToken,
	guardrails,
	tags,
}: ModelPolicySettingsProps) {
	const litellmParams = modelData.litellm_params ?? {};

	return (
		<>
			<ModelSettingField
				label={
					<DocumentationLabel
						label="Guardrails"
						tooltip="Apply safety guardrails to this model to filter content or enforce policies"
						href="https://docs.litellm.ai/docs/proxy/guardrails/quick_start"
					/>
				}
				editing={editing}
				editor={
					<Form.Item name="guardrails" className="mb-0">
						<Select
							mode="tags"
							showSearch
							placeholder="Select existing guardrails or type to create new ones"
							optionFilterProp="children"
							tokenSeparators={[","]}
							maxTagCount="responsive"
							allowClear
							style={{ width: "100%" }}
							options={guardrails.map((name) => ({ value: name, label: name }))}
						/>
					</Form.Item>
				}
			>
				<ModelValueList
					value={litellmParams.guardrails}
					emptyLabel="No guardrails assigned"
					pillClassName="bg-green-100 text-green-800"
				/>
			</ModelSettingField>
			<ModelSettingField
				label={
					<DocumentationLabel
						label="Attached Knowledge Bases (RAG)"
						tooltip="Vector stores used for RAG. Every request to this model will automatically retrieve context from these knowledge bases."
						href="https://docs.litellm.ai/docs/completion/knowledgebase"
					/>
				}
				editing={editing}
				editor={
					<Form.Item name="vector_store_ids" className="mb-0">
						<VectorStoreSelector
							onChange={() => undefined}
							accessToken={accessToken || ""}
							placeholder="Select knowledge bases (optional)"
						/>
					</Form.Item>
				}
			>
				<ModelValueList
					value={litellmParams.vector_store_ids}
					emptyLabel="No knowledge bases attached"
					pillClassName="bg-blue-100 text-blue-800"
				/>
			</ModelSettingField>
			<ModelSettingField
				label="Tags"
				editing={editing}
				editor={
					<Form.Item name="tags" className="mb-0">
						<Select
							mode="tags"
							showSearch
							placeholder="Select existing tags or type to create new ones"
							optionFilterProp="children"
							tokenSeparators={[","]}
							maxTagCount="responsive"
							allowClear
							style={{ width: "100%" }}
							options={Object.values(tags).map((tag) => ({
								value: tag.name,
								label: tag.name,
								title: tag.description || tag.name,
							}))}
						/>
					</Form.Item>
				}
			>
				<ModelValueList
					value={litellmParams.tags}
					emptyLabel="No tags assigned"
					pillClassName="bg-purple-100 text-purple-800"
				/>
			</ModelSettingField>
		</>
	);
}
