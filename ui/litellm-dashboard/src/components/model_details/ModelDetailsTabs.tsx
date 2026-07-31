import { Button, Card, Tab, TabGroup, TabList, TabPanel, TabPanels, Text, Title } from "@tremor/react";
import type { FormInstance } from "antd";
import type { CredentialItem } from "../networking";
import type { Tag } from "../tag_management/types";
import ModelOverview from "./ModelOverview";
import ModelSettingsContent from "./ModelSettingsContent";
import ModelSettingsDialog from "./ModelSettingsDialog";

interface ModelDetailsTabsProps {
	modelData: any;
	localModelData: any;
	canEditModel: boolean;
	isAutoRouter: boolean;
	isEditing: boolean;
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
	onEditAutoRouter: () => void;
	onEditingChange: (editing: boolean) => void;
	onCacheControlChange: (enabled: boolean) => void;
	onSave: (values: any) => void | Promise<void>;
}

export default function ModelDetailsTabs(props: ModelDetailsTabsProps) {
	return (
		<TabGroup>
			<TabList className="mb-3">
				<Tab>Overview</Tab>
				<Tab>Raw JSON</Tab>
			</TabList>
			<TabPanels>
				<TabPanel>
					<ModelOverview modelData={props.modelData} />
					<Card className="p-3">
						<div className="mb-2 flex items-center justify-between">
							<Title>Model Settings</Title>
							{props.isAutoRouter && props.canEditModel && (
								<Button onClick={props.onEditAutoRouter} className="flex items-center">
									Edit Auto Router
								</Button>
							)}
						</div>
						{props.localModelData ? (
							<ModelSettingsContent
								editing={false}
								modelData={props.localModelData}
								modelAccessGroups={props.modelAccessGroups}
								accessToken={props.accessToken}
								guardrails={props.guardrails}
								tags={props.tags}
								selectedCredentialName={props.selectedCredentialName}
								credentials={props.credentials}
								isWildcardModel={props.isWildcardModel}
								modelHubData={props.modelHubData}
								form={props.form}
								showCacheControl={props.showCacheControl}
								isSaving={props.isSaving}
								onCacheControlChange={props.onCacheControlChange}
								onCancel={() => undefined}
							/>
						) : (
							<Text>Loading...</Text>
						)}
					</Card>
					{props.localModelData && (
						<ModelSettingsDialog
							open={props.isEditing}
							onCancel={() => props.onEditingChange(false)}
							onSave={props.onSave}
							modelData={props.localModelData}
							modelAccessGroups={props.modelAccessGroups}
							accessToken={props.accessToken}
							guardrails={props.guardrails}
							tags={props.tags}
							selectedCredentialName={props.selectedCredentialName}
							credentials={props.credentials}
							isWildcardModel={props.isWildcardModel}
							modelHubData={props.modelHubData}
							form={props.form}
							showCacheControl={props.showCacheControl}
							isSaving={props.isSaving}
							onCacheControlChange={props.onCacheControlChange}
						/>
					)}
				</TabPanel>
				<TabPanel>
					<Card className="p-3">
						<details>
							<summary className="cursor-pointer text-sm font-medium text-gray-600">Expand complete model JSON</summary>
							<pre className="mt-2 max-h-[70vh] overflow-auto rounded bg-gray-100 p-3 text-xs">
								{JSON.stringify(props.modelData, null, 2)}
							</pre>
						</details>
					</Card>
				</TabPanel>
			</TabPanels>
		</TabGroup>
	);
}
