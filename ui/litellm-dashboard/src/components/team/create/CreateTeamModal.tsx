import { InfoCircleOutlined } from "@ant-design/icons";
import { Accordion, AccordionBody, AccordionHeader } from "@tremor/react";
import { Button, Form, type FormInstance, Input, Modal, Select, Tooltip, Typography } from "antd";
import type { Organization } from "../../networking";
import ModelAliasManager from "../../common_components/ModelAliasManager";
import PremiumLoggingSettings from "../../common_components/PremiumLoggingSettings";
import RouterSettingsAccordion, {
  type RouterSettingsAccordionValue,
} from "../../common_components/RouterSettingsAccordion";
import TeamAdvancedSettingsFields from "../settings/TeamAdvancedSettingsFields";
import TeamGeneralSettingsFields from "../settings/TeamGeneralSettingsFields";
import TeamPolicySettingsFields from "../settings/TeamPolicySettingsFields";
import TeamResourcePermissionFields from "../settings/TeamResourcePermissionFields";

interface CreateTeamModalProps {
  open: boolean;
  form: FormInstance;
  userRole: string | null;
  userId: string | null;
  organizations: Organization[] | null;
  currentOrganizationId: string | null;
  selectedOrganizationId: string | null;
  premiumUser: boolean;
  accessToken: string | null;
  guardrails: string[];
  policies: string[];
  loggingSettings: any[];
  routerSettings: RouterSettingsAccordionValue | null;
  routerSettingsKey: number;
  userModels: string[];
  modelAliases: Record<string, string>;
  onOrganizationChange: (organizationId: string | null) => void;
  onLoggingSettingsChange: (settings: any[]) => void;
  onRouterSettingsChange: (settings: RouterSettingsAccordionValue) => void;
  onModelAliasesChange: (aliases: Record<string, string>) => void;
  onSubmit: (values: Record<string, any>) => void | Promise<void>;
  onCancel: () => void;
}

const getAdminOrganizations = (
  userRole: string | null,
  userId: string | null,
  organizations: Organization[] | null,
) => {
  if (userRole === "Admin") return organizations || [];
  if (!organizations || !userId) return [];
  return organizations.filter((organization) =>
    organization.members?.some((member) => member.user_id === userId && member.user_role === "org_admin"),
  );
};

export default function CreateTeamModal(props: CreateTeamModalProps) {
  const { Text } = Typography;
  const adminOrganizations = getAdminOrganizations(props.userRole, props.userId, props.organizations);
  const isOrganizationAdmin = props.userRole !== "Admin";
  const hasSingleOrganization = adminOrganizations.length === 1;
  const hasNoOrganizations = adminOrganizations.length === 0;

  return (
    <Modal title="Create Team" open={props.open} width={1000} footer={null} onCancel={props.onCancel}>
      <Form
        form={props.form}
        onFinish={props.onSubmit}
        labelCol={{ span: 8 }}
        wrapperCol={{ span: 16 }}
        labelAlign="left"
      >
        <Form.Item
          label="Team Name"
          name="team_alias"
          rules={[{ required: true, message: "Please input a team name" }]}
        >
          <Input />
        </Form.Item>
        <Form.Item
          label={
            <span>
              Organization{" "}
              <Tooltip
                title={
                  <span>
                    Organizations can have multiple teams. Learn more about{" "}
                    <a
                      href="https://docs.litellm.ai/docs/proxy/user_management_heirarchy"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-500 underline"
                      onClick={(event) => event.stopPropagation()}
                    >
                      user management hierarchy
                    </a>
                  </span>
                }
              >
                <InfoCircleOutlined className="ml-1" />
              </Tooltip>
            </span>
          }
          name="organization_id"
          initialValue={props.currentOrganizationId}
          className="mt-8"
          rules={isOrganizationAdmin ? [{ required: true, message: "Please select an organization" }] : []}
          help={
            hasSingleOrganization
              ? "You can only create teams within this organization"
              : isOrganizationAdmin
                ? "required"
                : ""
          }
        >
          <Select
            showSearch
            allowClear={!isOrganizationAdmin}
            disabled={hasSingleOrganization}
            placeholder={hasNoOrganizations ? "No organizations available" : "Search or select an Organization"}
            onChange={(value) => {
              props.form.setFieldValue("organization_id", value);
              props.onOrganizationChange(value || null);
            }}
            filterOption={(input, option) =>
              Boolean(option?.children?.toString().toLowerCase().includes(input.toLowerCase()))
            }
            optionFilterProp="children"
          >
            {adminOrganizations.map((organization) => (
              <Select.Option key={organization.organization_id} value={organization.organization_id}>
                <span className="font-medium">{organization.organization_alias}</span>{" "}
                <span className="text-gray-500">({organization.organization_id})</span>
              </Select.Option>
            ))}
          </Select>
        </Form.Item>
        {isOrganizationAdmin && !hasSingleOrganization && adminOrganizations.length > 1 && (
          <div className="mb-8 rounded-md border border-blue-200 bg-blue-50 p-4">
            <Text className="text-sm text-blue-800">
              Please select an organization to create a team for. You can only create teams within organizations where
              you are an admin.
            </Text>
          </div>
        )}

        <TeamGeneralSettingsFields
          form={props.form}
          userRole={props.userRole}
          organizationId={props.selectedOrganizationId}
          mode="create"
          showTeamName={false}
        />

        <Accordion className="mb-8 mt-20">
          <AccordionHeader>
            <b>Additional Settings</b>
          </AccordionHeader>
          <AccordionBody>
            <TeamAdvancedSettingsFields
              form={props.form}
              premiumUser={props.premiumUser}
              mode="create"
              showLoggingSettings={false}
            />
            <TeamPolicySettingsFields
              guardrails={props.guardrails}
              policies={props.policies}
              premiumUser={props.premiumUser}
            />
          </AccordionBody>
        </Accordion>

        <Accordion className="mb-8 mt-8">
          <AccordionHeader>
            <b>Resource Permissions</b>
          </AccordionHeader>
          <AccordionBody>
            <TeamResourcePermissionFields form={props.form} accessToken={props.accessToken} mode="create" />
          </AccordionBody>
        </Accordion>

        <Accordion className="mb-8 mt-8">
          <AccordionHeader>
            <b>Logging Settings</b>
          </AccordionHeader>
          <AccordionBody>
            <div className="mt-4">
              <PremiumLoggingSettings
                value={props.loggingSettings}
                onChange={props.onLoggingSettingsChange}
                premiumUser={props.premiumUser}
              />
            </div>
          </AccordionBody>
        </Accordion>

        <Accordion key={`router-settings-${props.routerSettingsKey}`} className="mb-8 mt-8">
          <AccordionHeader>
            <b>Router Settings</b>
          </AccordionHeader>
          <AccordionBody>
            <div className="mt-4 w-full">
              <RouterSettingsAccordion
                accessToken={props.accessToken || ""}
                value={props.routerSettings || undefined}
                onChange={props.onRouterSettingsChange}
                modelData={
                  props.userModels.length > 0
                    ? { data: props.userModels.map((model) => ({ model_name: model })) }
                    : undefined
                }
              />
            </div>
          </AccordionBody>
        </Accordion>

        <Accordion className="mb-8 mt-8">
          <AccordionHeader>
            <b>Model Aliases</b>
          </AccordionHeader>
          <AccordionBody>
            <div className="mt-4">
              <Text type="secondary" className="mb-4 block text-sm">
                Create custom aliases for models that can be used by team members in API calls.
              </Text>
              <ModelAliasManager
                accessToken={props.accessToken || ""}
                initialModelAliases={props.modelAliases}
                onAliasUpdate={props.onModelAliasesChange}
                showExampleConfig={false}
              />
            </div>
          </AccordionBody>
        </Accordion>

        <div className="mt-2 text-right">
          <Button htmlType="submit">Create Team</Button>
        </div>
      </Form>
    </Modal>
  );
}
