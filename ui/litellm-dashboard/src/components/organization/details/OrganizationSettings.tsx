import MCPServerSelector from "@/components/mcp_server_management/MCPServerSelector";
import { ModelSelect } from "@/components/ModelSelect/ModelSelect";
import type { Organization } from "@/components/networking";
import ObjectPermissionsView from "@/components/object_permissions_view";
import NumericalInput from "@/components/shared/numerical_input";
import VectorStoreSelector from "@/components/vector_store_management/VectorStoreSelector";
import { formatNumberWithCommas } from "@/utils/dataUtils";
import { Button, Card, Text, TextInput, Title } from "@tremor/react";
import { Form, Input, Select, type FormInstance } from "antd";

export interface OrganizationFormValues {
	organization_alias: string;
	models: string[];
	tpm_limit: number | null;
	rpm_limit: number | null;
	max_budget: number | null;
	budget_duration: string | null;
	metadata?: string;
	vector_stores?: string[];
	mcp_servers_and_groups?: {
		servers?: string[];
		accessGroups?: string[];
	};
}

interface OrganizationSettingsProps {
	organization: Organization;
	form: FormInstance<OrganizationFormValues>;
	accessToken: string | null;
	canEdit: boolean;
	editing: boolean;
	saving: boolean;
	onEdit: () => void;
	onCancel: () => void;
	onSave: (values: OrganizationFormValues) => void;
}

export default function OrganizationSettings({
	organization,
	form,
	accessToken,
	canEdit,
	editing,
	saving,
	onEdit,
	onCancel,
	onSave,
}: OrganizationSettingsProps) {
	const budget = organization.litellm_budget_table;

	return (
		<Card className="max-h-[65vh] overflow-y-auto">
			<div className="mb-4 flex items-center justify-between">
				<Title>Organization Settings</Title>
				{canEdit && !editing && <Button onClick={onEdit}>Edit Settings</Button>}
			</div>

			{editing ? (
				<Form<OrganizationFormValues>
					form={form}
					onFinish={onSave}
					initialValues={{
						organization_alias: organization.organization_alias,
						models: organization.models,
						tpm_limit: budget.tpm_limit,
						rpm_limit: budget.rpm_limit,
						max_budget: budget.max_budget,
						budget_duration: budget.budget_duration,
						metadata: organization.metadata
							? JSON.stringify(organization.metadata, null, 2)
							: "",
						vector_stores: organization.object_permission?.vector_stores || [],
						mcp_servers_and_groups: {
							servers: organization.object_permission?.mcp_servers || [],
							accessGroups:
								organization.object_permission?.mcp_access_groups || [],
						},
					}}
					layout="vertical"
				>
					<Form.Item
						label="Organization Name"
						name="organization_alias"
						rules={[{ required: true, message: "Please input an organization name" }]}
					>
						<TextInput />
					</Form.Item>
					<Form.Item label="Models" name="models">
						<ModelSelect
							value={form.getFieldValue("models")}
							onChange={(values) => form.setFieldValue("models", values)}
							context="organization"
							options={{
								includeSpecialOptions: true,
								showAllProxyModelsOverride: true,
							}}
						/>
					</Form.Item>
					<Form.Item label="Max Budget (USD)" name="max_budget">
						<NumericalInput step={0.01} precision={2} style={{ width: "100%" }} />
					</Form.Item>
					<Form.Item label="Reset Budget" name="budget_duration">
						<Select
							placeholder="n/a"
							options={[
								{ value: "24h", label: "daily" },
								{ value: "7d", label: "weekly" },
								{ value: "30d", label: "monthly" },
							]}
						/>
					</Form.Item>
					<Form.Item label="Tokens per minute Limit (TPM)" name="tpm_limit">
						<NumericalInput step={1} style={{ width: "100%" }} />
					</Form.Item>
					<Form.Item label="Requests per minute Limit (RPM)" name="rpm_limit">
						<NumericalInput step={1} style={{ width: "100%" }} />
					</Form.Item>
					<Form.Item label="Vector Stores" name="vector_stores">
						<VectorStoreSelector
							onChange={(values) => form.setFieldValue("vector_stores", values)}
							value={form.getFieldValue("vector_stores")}
							accessToken={accessToken || ""}
							placeholder="Select vector stores"
						/>
					</Form.Item>
					<Form.Item label="MCP Servers & Access Groups" name="mcp_servers_and_groups">
						<MCPServerSelector
							onChange={(values) =>
								form.setFieldValue("mcp_servers_and_groups", values)
							}
							value={form.getFieldValue("mcp_servers_and_groups")}
							accessToken={accessToken || ""}
							placeholder="Select MCP servers and access groups"
						/>
					</Form.Item>
					<Form.Item label="Metadata" name="metadata">
						<Input.TextArea rows={4} />
					</Form.Item>
					<div className="sticky inset-x-[-1.5rem] bottom-[-1.5rem] z-10 border-t border-gray-200 bg-white p-4">
						<div className="flex items-center justify-end gap-2">
							<Button variant="secondary" onClick={onCancel} disabled={saving}>
								Cancel
							</Button>
							<Button type="submit" loading={saving}>
								Save Changes
							</Button>
						</div>
					</div>
				</Form>
			) : (
				<div className="space-y-4">
					<div>
						<Text className="font-medium">Organization Name</Text>
						<div>{organization.organization_alias}</div>
					</div>
					<div>
						<Text className="font-medium">Organization ID</Text>
						<div className="font-mono">{organization.organization_id}</div>
					</div>
					<div>
						<Text className="font-medium">Created At</Text>
						<div>{new Date(organization.created_at).toLocaleString()}</div>
					</div>
					<div>
						<Text className="font-medium">Models</Text>
						<div className="mt-1 flex flex-wrap gap-2">
							{organization.models.map((model) => (
								<span key={model}>{model}</span>
							))}
						</div>
					</div>
					<div>
						<Text className="font-medium">Rate Limits</Text>
						<div>TPM: {budget.tpm_limit || "Unlimited"}</div>
						<div>RPM: {budget.rpm_limit || "Unlimited"}</div>
					</div>
					<div>
						<Text className="font-medium">Budget</Text>
						<div>
							Max:{" "}
							{budget.max_budget !== null
								? `$${formatNumberWithCommas(budget.max_budget, 4)}`
								: "No Limit"}
						</div>
						<div>Reset: {budget.budget_duration || "Never"}</div>
					</div>
					<ObjectPermissionsView
						objectPermission={organization.object_permission}
						variant="inline"
						className="border-t border-gray-200 pt-4"
						accessToken={accessToken}
					/>
				</div>
			)}
		</Card>
	);
}

