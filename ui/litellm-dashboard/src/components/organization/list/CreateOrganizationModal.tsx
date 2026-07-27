import { InfoCircleOutlined } from "@ant-design/icons";
import { Button, TextInput } from "@tremor/react";
import { Form, type FormInstance, Input, Modal, Select, Tooltip } from "antd";
import MCPServerSelector from "../../mcp_server_management/MCPServerSelector";
import { ModelSelect } from "../../ModelSelect/ModelSelect";
import NumericalInput from "../../shared/numerical_input";
import VectorStoreSelector from "../../vector_store_management/VectorStoreSelector";

export interface CreateOrganizationValues {
  organization_alias: string;
  models?: string[];
  max_budget?: number | null;
  budget_duration?: string | null;
  tpm_limit?: number | null;
  rpm_limit?: number | null;
  allowed_vector_store_ids?: string[];
  allowed_mcp_servers_and_groups?: {
    servers?: string[];
    accessGroups?: string[];
  };
  object_permission?: {
    vector_stores?: string[];
    mcp_servers?: string[];
    mcp_access_groups?: string[];
  };
  metadata?: string;
}

interface CreateOrganizationModalProps {
  open: boolean;
  accessToken: string | null;
  form: FormInstance<CreateOrganizationValues>;
  onCancel: () => void;
  onCreate: (values: CreateOrganizationValues) => void | Promise<void>;
}

export function normalizeCreateOrganizationValues(values: CreateOrganizationValues): CreateOrganizationValues {
  const { allowed_vector_store_ids, allowed_mcp_servers_and_groups, ...baseValues } = values;
  const vectorStores = allowed_vector_store_ids ?? [];
  const mcpServers = allowed_mcp_servers_and_groups?.servers ?? [];
  const mcpAccessGroups = allowed_mcp_servers_and_groups?.accessGroups ?? [];

  if (vectorStores.length === 0 && mcpServers.length === 0 && mcpAccessGroups.length === 0) {
    return baseValues;
  }

  return {
    ...baseValues,
    object_permission: {
      ...(vectorStores.length > 0 ? { vector_stores: vectorStores } : {}),
      ...(mcpServers.length > 0 ? { mcp_servers: mcpServers } : {}),
      ...(mcpAccessGroups.length > 0 ? { mcp_access_groups: mcpAccessGroups } : {}),
    },
  };
}

export default function CreateOrganizationModal({
  open,
  accessToken,
  form,
  onCancel,
  onCreate,
}: CreateOrganizationModalProps) {
  return (
    <Modal title="Create Organization" open={open} width={800} footer={null} onCancel={onCancel}>
      <Form
        form={form}
        onFinish={(values) => onCreate(normalizeCreateOrganizationValues(values))}
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 16 }}
        labelAlign="left"
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
            options={{ showAllProxyModelsOverride: true, includeSpecialOptions: true }}
            value={form.getFieldValue("models")}
            onChange={(values) => form.setFieldValue("models", values)}
            context="organization"
          />
        </Form.Item>
        <Form.Item label="Max Budget (USD)" name="max_budget">
          <NumericalInput step={0.01} precision={2} width={200} />
        </Form.Item>
        <Form.Item label="Reset Budget" name="budget_duration">
          <Select placeholder="n/a">
            <Select.Option value="24h">daily</Select.Option>
            <Select.Option value="7d">weekly</Select.Option>
            <Select.Option value="30d">monthly</Select.Option>
          </Select>
        </Form.Item>
        <Form.Item label="Tokens per minute Limit (TPM)" name="tpm_limit">
          <NumericalInput step={1} width={400} />
        </Form.Item>
        <Form.Item label="Requests per minute Limit (RPM)" name="rpm_limit">
          <NumericalInput step={1} width={400} />
        </Form.Item>
        <Form.Item
          label={
            <span>
              Allowed Vector Stores{" "}
              <Tooltip title="Select which vector stores this organization can access by default. Leave empty for access to all vector stores">
                <InfoCircleOutlined className="ml-1" />
              </Tooltip>
            </span>
          }
          name="allowed_vector_store_ids"
          className="mt-4"
          help="Select vector stores this organization can access. Leave empty for access to all vector stores"
        >
          <VectorStoreSelector
            onChange={(values) => form.setFieldValue("allowed_vector_store_ids", values)}
            value={form.getFieldValue("allowed_vector_store_ids")}
            accessToken={accessToken || ""}
            placeholder="Select vector stores (optional)"
          />
        </Form.Item>
        <Form.Item
          label={
            <span>
              Allowed MCP Servers{" "}
              <Tooltip title="Select which MCP servers and access groups this organization can access by default.">
                <InfoCircleOutlined className="ml-1" />
              </Tooltip>
            </span>
          }
          name="allowed_mcp_servers_and_groups"
          className="mt-4"
          help="Select MCP servers and access groups this organization can access."
        >
          <MCPServerSelector
            onChange={(values) => form.setFieldValue("allowed_mcp_servers_and_groups", values)}
            value={form.getFieldValue("allowed_mcp_servers_and_groups")}
            accessToken={accessToken || ""}
            placeholder="Select MCP servers and access groups (optional)"
          />
        </Form.Item>
        <Form.Item label="Metadata" name="metadata">
          <Input.TextArea rows={4} />
        </Form.Item>
        <div className="mt-2 text-right">
          <Button type="submit">Create Organization</Button>
        </div>
      </Form>
    </Modal>
  );
}
