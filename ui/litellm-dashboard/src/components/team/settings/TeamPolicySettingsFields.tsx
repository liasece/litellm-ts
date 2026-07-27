import { InfoCircleOutlined } from "@ant-design/icons";
import { Form, Select, Switch, Tooltip } from "antd";
import AccessGroupSelector from "../../common_components/AccessGroupSelector";

interface TeamPolicySettingsFieldsProps {
	guardrails: string[];
	policies: string[];
	premiumUser?: boolean;
}

function DocumentationLabel({ label, tooltip, href }: { label: string; tooltip: string; href?: string }) {
	const icon = <InfoCircleOutlined style={{ marginLeft: 4 }} />;
	return (
		<span>
			{label}{" "}
			<Tooltip title={tooltip}>
				{href ? (
					<a href={href} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>
						{icon}
					</a>
				) : (
					icon
				)}
			</Tooltip>
		</span>
	);
}

export default function TeamPolicySettingsFields({
	guardrails,
	policies,
	premiumUser = true,
}: TeamPolicySettingsFieldsProps) {
	return (
		<>
			<Form.Item
				label={
					<DocumentationLabel
						label="Guardrails"
						tooltip="Setup your first guardrail"
						href="https://docs.litellm.ai/docs/proxy/guardrails/quick_start"
					/>
				}
				name="guardrails"
				help="Select existing guardrails or enter new ones"
			>
				<Select
					mode="tags"
					placeholder="Select or enter guardrails"
					options={guardrails.map((name) => ({ value: name, label: name }))}
				/>
			</Form.Item>
			<Form.Item
				label={
					<DocumentationLabel
						label="Disable Global Guardrails"
						tooltip="When enabled, this team will bypass any guardrails configured to run on every request (global guardrails)"
					/>
				}
				name="disable_global_guardrails"
				valuePropName="checked"
				help="Bypass global guardrails for this team"
			>
				<Switch disabled={!premiumUser} checkedChildren="Yes" unCheckedChildren="No" />
			</Form.Item>
			<Form.Item
				label={
					<DocumentationLabel
						label="Policies"
						tooltip="Apply policies to this team to control guardrails and other settings"
						href="https://docs.litellm.ai/docs/proxy/guardrails/guardrail_policies"
					/>
				}
				name="policies"
				help="Select existing policies or enter new ones"
			>
				<Select
					mode="tags"
					placeholder="Select or enter policies"
					options={policies.map((name) => ({ value: name, label: name }))}
				/>
			</Form.Item>
			<Form.Item
				label={
					<DocumentationLabel
						label="Access Groups"
						tooltip="Assign access groups to this team. Access groups control which models, MCP servers, and agents this team can use"
					/>
				}
				name="access_group_ids"
			>
				<AccessGroupSelector placeholder="Select access groups (optional)" />
			</Form.Item>
		</>
	);
}
