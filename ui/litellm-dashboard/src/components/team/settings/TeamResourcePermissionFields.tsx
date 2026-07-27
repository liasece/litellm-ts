import { Form, Input, type FormInstance } from "antd";
import AgentSelector from "../../agent_management/AgentSelector";
import PassThroughRoutesSelector from "../../common_components/PassThroughRoutesSelector";
import MCPServerSelector from "../../mcp_server_management/MCPServerSelector";
import MCPToolPermissions from "../../mcp_server_management/MCPToolPermissions";
import VectorStoreSelector from "../../vector_store_management/VectorStoreSelector";

interface TeamResourcePermissionFieldsProps {
	form: FormInstance;
	accessToken: string | null;
	mode?: "create" | "edit";
}

export default function TeamResourcePermissionFields({
	form,
	accessToken,
	mode = "edit",
}: TeamResourcePermissionFieldsProps) {
	const vectorStoresField = mode === "create" ? "allowed_vector_store_ids" : "vector_stores";
	const mcpField = mode === "create" ? "allowed_mcp_servers_and_groups" : "mcp_servers_and_groups";
	const agentsField = mode === "create" ? "allowed_agents_and_groups" : "agents_and_groups";

	return (
		<>
			<Form.Item label="Vector Stores" name={vectorStoresField} aria-label="Vector Stores">
				<VectorStoreSelector
					onChange={(values: string[]) => form.setFieldValue(vectorStoresField, values)}
					value={form.getFieldValue(vectorStoresField)}
					accessToken={accessToken || ""}
					placeholder="Select vector stores"
				/>
			</Form.Item>
			{mode === "edit" && (
				<Form.Item label="Allowed Pass Through Routes" name="allowed_passthrough_routes">
					<PassThroughRoutesSelector
						onChange={(values: string[]) => form.setFieldValue("allowed_passthrough_routes", values)}
						value={form.getFieldValue("allowed_passthrough_routes")}
						accessToken={accessToken || ""}
						placeholder="Select pass through routes"
					/>
				</Form.Item>
			)}
			<Form.Item label="MCP Servers / Access Groups" name={mcpField}>
				<MCPServerSelector
					onChange={(value) => form.setFieldValue(mcpField, value)}
					value={form.getFieldValue(mcpField)}
					accessToken={accessToken || ""}
					placeholder="Select MCP servers or access groups (optional)"
				/>
			</Form.Item>
			<Form.Item name="mcp_tool_permissions" hidden>
				<Input type="hidden" />
			</Form.Item>
			<Form.Item
				noStyle
				shouldUpdate={(previous, current) =>
					previous[mcpField] !== current[mcpField] || previous.mcp_tool_permissions !== current.mcp_tool_permissions
				}
			>
				{() => (
					<div className="mb-6">
						<MCPToolPermissions
							accessToken={accessToken || ""}
							selectedServers={form.getFieldValue(mcpField)?.servers || []}
							toolPermissions={form.getFieldValue("mcp_tool_permissions") || {}}
							onChange={(permissions) => form.setFieldsValue({ mcp_tool_permissions: permissions })}
						/>
					</div>
				)}
			</Form.Item>
			<Form.Item label="Agents / Access Groups" name={agentsField}>
				<AgentSelector
					onChange={(value) => form.setFieldValue(agentsField, value)}
					value={form.getFieldValue(agentsField)}
					accessToken={accessToken || ""}
					placeholder="Select agents or access groups (optional)"
				/>
			</Form.Item>
		</>
	);
}
