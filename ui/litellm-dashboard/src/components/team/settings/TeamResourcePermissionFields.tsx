import { Form, Input, type FormInstance } from "antd";
import AgentSelector from "../../agent_management/AgentSelector";
import PassThroughRoutesSelector from "../../common_components/PassThroughRoutesSelector";
import MCPServerSelector from "../../mcp_server_management/MCPServerSelector";
import MCPToolPermissions from "../../mcp_server_management/MCPToolPermissions";
import VectorStoreSelector from "../../vector_store_management/VectorStoreSelector";

interface TeamResourcePermissionFieldsProps {
	form: FormInstance;
	accessToken: string | null;
}

export default function TeamResourcePermissionFields({ form, accessToken }: TeamResourcePermissionFieldsProps) {
	return (
		<>
			<Form.Item label="Vector Stores" name="vector_stores" aria-label="Vector Stores">
				<VectorStoreSelector
					onChange={(values: string[]) => form.setFieldValue("vector_stores", values)}
					value={form.getFieldValue("vector_stores")}
					accessToken={accessToken || ""}
					placeholder="Select vector stores"
				/>
			</Form.Item>
			<Form.Item label="Allowed Pass Through Routes" name="allowed_passthrough_routes">
				<PassThroughRoutesSelector
					onChange={(values: string[]) => form.setFieldValue("allowed_passthrough_routes", values)}
					value={form.getFieldValue("allowed_passthrough_routes")}
					accessToken={accessToken || ""}
					placeholder="Select pass through routes"
				/>
			</Form.Item>
			<Form.Item label="MCP Servers / Access Groups" name="mcp_servers_and_groups">
				<MCPServerSelector
					onChange={(value) => form.setFieldValue("mcp_servers_and_groups", value)}
					value={form.getFieldValue("mcp_servers_and_groups")}
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
					previous.mcp_servers_and_groups !== current.mcp_servers_and_groups ||
					previous.mcp_tool_permissions !== current.mcp_tool_permissions
				}
			>
				{() => (
					<div className="mb-6">
						<MCPToolPermissions
							accessToken={accessToken || ""}
							selectedServers={form.getFieldValue("mcp_servers_and_groups")?.servers || []}
							toolPermissions={form.getFieldValue("mcp_tool_permissions") || {}}
							onChange={(permissions) => form.setFieldsValue({ mcp_tool_permissions: permissions })}
						/>
					</div>
				)}
			</Form.Item>
			<Form.Item label="Agents / Access Groups" name="agents_and_groups">
				<AgentSelector
					onChange={(value) => form.setFieldValue("agents_and_groups", value)}
					value={form.getFieldValue("agents_and_groups")}
					accessToken={accessToken || ""}
					placeholder="Select agents or access groups (optional)"
				/>
			</Form.Item>
		</>
	);
}
