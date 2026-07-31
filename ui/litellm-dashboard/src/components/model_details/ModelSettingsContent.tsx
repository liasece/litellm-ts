import { Button as TremorButton } from "@tremor/react";
import type { FormInstance } from "antd";
import { CredentialItem } from "../networking";
import { Tag } from "../tag_management/types";
import ModelAdvancedSettings from "./ModelAdvancedSettings";
import ModelBasicSettings from "./ModelBasicSettings";
import ModelCredentialSettings from "./ModelCredentialSettings";
import ModelPolicySettings from "./ModelPolicySettings";

export interface ModelSettingsContentProps {
	editing: boolean;
	modelData: any;
	modelAccessGroups: string[] | null;
	accessToken: string | null;
	guardrails: string[];
	tags: Record<string, Tag>;
	selectedCredentialName?: string;
	credentials: CredentialItem[];
	isWildcardModel: boolean;
	modelHubData: any;
	form: FormInstance;
	showCacheControl: boolean;
	isSaving: boolean;
	onCacheControlChange: (enabled: boolean) => void;
	onCancel: () => void;
}

export default function ModelSettingsContent({
	editing,
	modelData,
	modelAccessGroups,
	accessToken,
	guardrails,
	tags,
	selectedCredentialName,
	credentials,
	isWildcardModel,
	modelHubData,
	form,
	showCacheControl,
	isSaving,
	onCacheControlChange,
	onCancel,
}: ModelSettingsContentProps) {
	return (
		<div>
			<div className="grid grid-cols-1 overflow-hidden rounded-lg border border-gray-200 bg-white lg:grid-cols-2">
				<ModelBasicSettings editing={editing} modelData={modelData} modelAccessGroups={modelAccessGroups} />
				<ModelPolicySettings
					editing={editing}
					modelData={modelData}
					accessToken={accessToken}
					guardrails={guardrails}
					tags={tags}
				/>
				<ModelCredentialSettings
					editing={editing}
					modelData={modelData}
					selectedCredentialName={selectedCredentialName}
					credentials={credentials}
				/>
				<ModelAdvancedSettings
					editing={editing}
					modelData={modelData}
					isWildcardModel={isWildcardModel}
					modelHubData={modelHubData}
					form={form}
					showCacheControl={showCacheControl}
					onCacheControlChange={onCacheControlChange}
				/>
			</div>

			{editing && (
				<div className="mt-4 flex justify-end gap-2">
					<TremorButton variant="secondary" onClick={onCancel} disabled={isSaving}>
						Cancel
					</TremorButton>
					<TremorButton variant="primary" onClick={() => form.submit()} loading={isSaving}>
						Save Changes
					</TremorButton>
				</div>
			)}
		</div>
	);
}
