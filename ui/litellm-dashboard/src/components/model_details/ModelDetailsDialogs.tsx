import { Text } from "@tremor/react";
import { Modal } from "antd";
import DeleteResourceModal from "../common_components/DeleteResourceModal";
import EditAutoRouterModal from "../edit_auto_router/edit_auto_router_modal";
import ReuseCredentialsModal from "../model_add/reuse_credentials";
import type { CredentialItem } from "../networking";

interface ModelDetailsDialogsProps {
  modelData: any;
  localModelData: any;
  accessToken: string | null;
  userRole: string | null;
  deleteOpen: boolean;
  deleteLoading: boolean;
  credentialOpen: boolean;
  usingExistingCredential: boolean;
  existingCredential: CredentialItem | null;
  autoRouterOpen: boolean;
  onDeleteOpenChange: (open: boolean) => void;
  onDelete: () => void | Promise<void>;
  onCredentialOpenChange: (open: boolean) => void;
  onReuseCredential: (values: { credential_name: string }) => void | Promise<void>;
  onAutoRouterOpenChange: (open: boolean) => void;
  onAutoRouterUpdate: (model: any) => void;
}

export default function ModelDetailsDialogs(props: ModelDetailsDialogsProps) {
  return (
    <>
      <DeleteResourceModal
        isOpen={props.deleteOpen}
        title="Delete Model"
        alertMessage="This action cannot be undone."
        message="Are you sure you want to delete this model?"
        resourceInformationTitle="Model Information"
        resourceInformation={[
          { label: "Model Name", value: props.modelData?.model_name || "Not Set" },
          { label: "LiteLLM Model Name", value: props.modelData?.litellm_model_name || "Not Set" },
          { label: "Provider", value: props.modelData?.provider || "Not Set" },
          { label: "Created By", value: props.modelData?.model_info?.created_by || "Not Set" },
        ]}
        onCancel={() => props.onDeleteOpenChange(false)}
        onOk={props.onDelete}
        confirmLoading={props.deleteLoading}
      />

      {props.credentialOpen && !props.usingExistingCredential ? (
        <ReuseCredentialsModal
          isVisible
          onCancel={() => props.onCredentialOpenChange(false)}
          onAddCredential={props.onReuseCredential}
          existingCredential={props.existingCredential}
          setIsCredentialModalOpen={props.onCredentialOpenChange}
        />
      ) : (
        <Modal
          open={props.credentialOpen}
          onCancel={() => props.onCredentialOpenChange(false)}
          title="Using Existing Credential"
        >
          <Text>{props.localModelData?.litellm_params?.litellm_credential_name}</Text>
        </Modal>
      )}

      <EditAutoRouterModal
        isVisible={props.autoRouterOpen}
        onCancel={() => props.onAutoRouterOpenChange(false)}
        onSuccess={props.onAutoRouterUpdate}
        modelData={props.localModelData || props.modelData}
        accessToken={props.accessToken || ""}
        userRole={props.userRole || ""}
      />
    </>
  );
}
