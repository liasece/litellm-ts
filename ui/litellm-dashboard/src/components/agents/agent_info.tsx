import React, { useEffect, useState } from "react";
import { Card, Tab, TabGroup, TabList, TabPanel, TabPanels, Text, Title } from "@tremor/react";
import { Button, Descriptions, Divider, Form, Input, InputNumber, Modal } from "antd";
import MessageManager from "@/components/molecules/message_manager";
import ResourceDetailsDrawer from "../common_components/ResourceDetailsDrawer";
import { getAgentCreateMetadata, getAgentInfo, patchAgentCall, AgentCreateInfo } from "../networking";
import { buildAgentDataFromForm, parseAgentForForm } from "./agent_config";
import AgentCostView from "./agent_cost_view";
import AgentFormFields from "./agent_form_fields";
import { Agent } from "./types";
import DynamicAgentFormFields, { buildDynamicAgentData } from "./dynamic_agent_form_fields";
import { detectAgentType, parseDynamicAgentForForm } from "./agent_type_utils";

interface AgentInfoViewProps {
  agentId: string;
  onClose: () => void;
  accessToken: string | null;
  isAdmin: boolean;
	onAgentUpdated: () => void;
	onDelete: (agentId: string, agentName: string) => void;
}

const AgentInfoView: React.FC<AgentInfoViewProps> = ({
  agentId,
  onClose,
  accessToken,
  isAdmin,
	onAgentUpdated,
	onDelete,
}) => {
  const [agent, setAgent] = useState<Agent | null>(null);
  const [isLoading, setIsLoading] = useState(true);
	const [loadError, setLoadError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [form] = Form.useForm();
  const [agentTypeMetadata, setAgentTypeMetadata] = useState<AgentCreateInfo[]>([]);
	const [detectedAgentType, setDetectedAgentType] = useState("a2a");

	const populateForm = (data: Agent) => {
		const agentType = detectAgentType(data);
		setDetectedAgentType(agentType);
		if (agentType === "a2a") {
			form.setFieldsValue(parseAgentForForm(data));
			return;
      }
		const typeInfo = agentTypeMetadata.find((item) => item.agent_type === agentType);
		form.setFieldsValue(typeInfo ? parseDynamicAgentForForm(data, typeInfo) : parseAgentForForm(data));
    };

  const fetchAgentInfo = async () => {
		if (!accessToken) {
			setLoadError("No access token available");
			setIsLoading(false);
			return;
		}

    setIsLoading(true);
		setLoadError(null);
    try {
      const data = await getAgentInfo(accessToken, agentId);
      setAgent(data);
			populateForm(data);
    } catch (error) {
      console.error("Error fetching agent info:", error);
			setLoadError("Failed to load agent information");
      MessageManager.error("Failed to load agent information");
    } finally {
      setIsLoading(false);
    }
  };

	useEffect(() => {
		void getAgentCreateMetadata()
			.then(setAgentTypeMetadata)
			.catch((error) => console.error("Error fetching agent metadata:", error));
	}, []);

	useEffect(() => {
		void fetchAgentInfo();
	}, [agentId, accessToken]);

  useEffect(() => {
    if (agent && agentTypeMetadata.length > 0) {
			populateForm(agent);
    }
  }, [agentTypeMetadata, agent]);

	const selectedAgentTypeInfo = agentTypeMetadata.find((item) => item.agent_type === detectedAgentType);

	const handleUpdate = async (values: Record<string, unknown>) => {
    if (!accessToken || !agent) return;

    setIsSaving(true);
    try {
			const updateData =
				detectedAgentType === "a2a"
					? buildAgentDataFromForm(values, agent)
					: selectedAgentTypeInfo
						? { ...buildDynamicAgentData(values, selectedAgentTypeInfo), agent_name: values.agent_name }
						: buildAgentDataFromForm(values, agent);
      await patchAgentCall(accessToken, agentId, updateData);
      MessageManager.success("Agent updated successfully");
      setIsEditing(false);
			onAgentUpdated();
			await fetchAgentInfo();
    } catch (error) {
      console.error("Error updating agent:", error);
      MessageManager.error("Failed to update agent");
    } finally {
      setIsSaving(false);
    }
  };

	const formatDate = (dateString?: string) => (dateString ? new Date(dateString).toLocaleString() : "-");
	const title = agent?.agent_name || "Agent details";

    return (
		<ResourceDetailsDrawer
			open
			onClose={onClose}
			title={title}
			subtitle={agent?.agent_id || agentId}
			loading={isLoading}
			error={loadError || (!isLoading && !agent ? "Agent not found" : undefined)}
			onRetry={() => void fetchAgentInfo()}
			actions={
				agent && isAdmin ? (
					<>
						<Button onClick={() => setIsEditing(true)} type="primary">
							Edit
						</Button>
						<Button danger onClick={() => onDelete(agent.agent_id, agent.agent_name)}>
							Delete
						</Button>
					</>
				) : undefined
  }
		>
			{agent && (
    <div className="p-4">
      <TabGroup>
        <TabList className="mb-4">
							<Tab>Overview</Tab>
        </TabList>
        <TabPanels>
          <TabPanel>
            <Descriptions bordered column={1}>
              <Descriptions.Item label="Agent ID">{agent.agent_id}</Descriptions.Item>
              <Descriptions.Item label="Agent Name">{agent.agent_name}</Descriptions.Item>
              <Descriptions.Item label="Display Name">{agent.agent_card_params?.name || "-"}</Descriptions.Item>
									<Descriptions.Item label="Description">
										{agent.agent_card_params?.description || "-"}
									</Descriptions.Item>
              <Descriptions.Item label="URL">{agent.agent_card_params?.url || "-"}</Descriptions.Item>
              <Descriptions.Item label="Version">{agent.agent_card_params?.version || "-"}</Descriptions.Item>
									<Descriptions.Item label="Protocol Version">
										{agent.agent_card_params?.protocolVersion || "-"}
									</Descriptions.Item>
              <Descriptions.Item label="Streaming">
                {agent.agent_card_params?.capabilities?.streaming ? "Yes" : "No"}
              </Descriptions.Item>
              {agent.agent_card_params?.capabilities?.pushNotifications && (
                <Descriptions.Item label="Push Notifications">Yes</Descriptions.Item>
              )}
              {agent.agent_card_params?.capabilities?.stateTransitionHistory && (
                <Descriptions.Item label="State Transition History">Yes</Descriptions.Item>
              )}
              <Descriptions.Item label="Skills">
                {agent.agent_card_params?.skills?.length || 0} configured
              </Descriptions.Item>
              {agent.litellm_params?.model && (
                <Descriptions.Item label="Model">{agent.litellm_params.model}</Descriptions.Item>
              )}
              {agent.litellm_params?.make_public !== undefined && (
										<Descriptions.Item label="Make Public">
											{agent.litellm_params.make_public ? "Yes" : "No"}
										</Descriptions.Item>
              )}
              {agent.agent_card_params?.iconUrl && (
                <Descriptions.Item label="Icon URL">{agent.agent_card_params.iconUrl}</Descriptions.Item>
              )}
              {agent.agent_card_params?.documentationUrl && (
										<Descriptions.Item label="Documentation URL">
											{agent.agent_card_params.documentationUrl}
										</Descriptions.Item>
              )}
              <Descriptions.Item label="TPM Limit">{agent.tpm_limit ?? "Unlimited"}</Descriptions.Item>
              <Descriptions.Item label="RPM Limit">{agent.rpm_limit ?? "Unlimited"}</Descriptions.Item>
									<Descriptions.Item label="Session TPM Limit">
										{agent.session_tpm_limit ?? "Unlimited"}
									</Descriptions.Item>
									<Descriptions.Item label="Session RPM Limit">
										{agent.session_rpm_limit ?? "Unlimited"}
									</Descriptions.Item>
              <Descriptions.Item label="Created At">{formatDate(agent.created_at)}</Descriptions.Item>
              <Descriptions.Item label="Updated At">{formatDate(agent.updated_at)}</Descriptions.Item>
            </Descriptions>
								<AgentCostView agent={agent} />
            {agent.object_permission &&
              (agent.object_permission.mcp_servers?.length ||
                agent.object_permission.mcp_access_groups?.length ||
										Object.keys(agent.object_permission.mcp_tool_permissions || {}).length > 0) && (
										<div className="mt-6">
                <Title>MCP Tool Permissions</Title>
											<Descriptions bordered column={1} className="mt-4">
												{agent.object_permission.mcp_servers?.length ? (
                    <Descriptions.Item label="MCP Servers">
                      {agent.object_permission.mcp_servers.join(", ")}
                    </Descriptions.Item>
												) : null}
												{agent.object_permission.mcp_access_groups?.length ? (
                      <Descriptions.Item label="MCP Access Groups">
                        {agent.object_permission.mcp_access_groups.join(", ")}
                      </Descriptions.Item>
												) : null}
												{Object.keys(agent.object_permission.mcp_tool_permissions || {}).length > 0 ? (
                      <Descriptions.Item label="Tool permissions per server">
														{Object.entries(agent.object_permission.mcp_tool_permissions || {}).map(
                            ([serverId, tools]) => (
                              <div key={serverId}>
                                <span className="font-medium">{serverId}:</span>{" "}
                                {Array.isArray(tools) ? tools.join(", ") : String(tools)}
                              </div>
															),
                          )}
                      </Descriptions.Item>
												) : null}
                </Descriptions>
              </div>
            )}
								{agent.agent_card_params?.skills?.length ? (
									<div className="mt-6">
                <Title>Skills</Title>
										<Descriptions bordered column={1} className="mt-4">
											{agent.agent_card_params.skills.map(
												(
													skill: {
														id?: string;
														name?: string;
														description?: string;
														tags?: string[] | string;
														examples?: string[];
													},
													index: number,
												) => (
													<Descriptions.Item label={skill.name || `Skill ${index + 1}`} key={skill.id || index}>
                      <div>
															<div>
																<strong>ID:</strong> {skill.id}
															</div>
															<div>
																<strong>Description:</strong> {skill.description}
															</div>
															<div>
																<strong>Tags:</strong> {Array.isArray(skill.tags) ? skill.tags.join(", ") : skill.tags}
															</div>
															{skill.examples?.length ? (
																<div>
																	<strong>Examples:</strong> {skill.examples.join(", ")}
																</div>
															) : null}
                      </div>
                    </Descriptions.Item>
												),
											)}
                </Descriptions>
              </div>
								) : null}
          </TabPanel>
						</TabPanels>
					</TabGroup>

					<Modal
						title="Edit Agent"
						open={isEditing}
						footer={null}
						onCancel={() => setIsEditing(false)}
						destroyOnHidden
						width={800}
                  >
						<Form form={form} layout="vertical" onFinish={handleUpdate}>
                    <Form.Item label="Agent ID">
                      <Input value={agent.agent_id} disabled />
                    </Form.Item>
							{detectedAgentType === "a2a" || !selectedAgentTypeInfo ? (
								<AgentFormFields showAgentName />
                    ) : (
								<DynamicAgentFormFields agentTypeInfo={selectedAgentTypeInfo} />
                    )}
                    <Divider />
                    <Title className="mb-4">Rate Limits</Title>
                    <div className="grid grid-cols-2 gap-4">
                      <Form.Item label="TPM Limit" name="tpm_limit">
                        <InputNumber className="w-full" min={0} placeholder="Unlimited" />
                      </Form.Item>
                      <Form.Item label="RPM Limit" name="rpm_limit">
                        <InputNumber className="w-full" min={0} placeholder="Unlimited" />
                      </Form.Item>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <Form.Item label="Session TPM Limit" name="session_tpm_limit">
                        <InputNumber className="w-full" min={0} placeholder="Unlimited" />
                      </Form.Item>
                      <Form.Item label="Session RPM Limit" name="session_rpm_limit">
                        <InputNumber className="w-full" min={0} placeholder="Unlimited" />
                      </Form.Item>
                    </div>
                    <div className="flex justify-end gap-2 mt-6">
								<Button onClick={() => setIsEditing(false)}>Cancel</Button>
								<Button htmlType="submit" type="primary" loading={isSaving}>
                        Save Changes
								</Button>
                    </div>
                  </Form>
					</Modal>
    </div>
			)}
		</ResourceDetailsDrawer>
  );
};

export default AgentInfoView;
