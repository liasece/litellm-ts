import React, { useState, useEffect } from "react";
import {
	Card,
	Table,
	TableHead,
	TableRow,
	Badge,
	TableHeaderCell,
	TableCell,
	TableBody,
	Text,
	Button,
	Icon,
	Switch,
} from "@tremor/react";
import { TabPanel, TabPanels, TabGroup, TabList, Tab } from "@tremor/react";
import {
	getGeneralSettingsCall,
	getWebSearchOverrideTargetCandidatesCall,
	updateConfigFieldSetting,
	deleteConfigFieldSetting,
} from "./networking";
import { Input, InputNumber, Select } from "antd";
import { TrashIcon, CheckCircleIcon } from "@heroicons/react/outline";

import RouterSettings from "./router_settings";
import Fallbacks from "./Settings/RouterSettings/Fallbacks/Fallbacks";
interface GeneralSettingsPageProps {
	accessToken: string | null;
	userRole: string | null;
	userID: string | null;
	modelData: any;
}

interface generalSettingsItem {
	field_name: string;
	field_type: string;
	field_value: any;
	field_description: string;
	stored_in_db: boolean | null;
}

const GeneralSettings: React.FC<GeneralSettingsPageProps> = ({ accessToken, userRole, userID, modelData }) => {
	const [generalSettings, setGeneralSettings] = useState<generalSettingsItem[]>([]);
	const [webSearchCandidates, setWebSearchCandidates] = useState<
		Awaited<ReturnType<typeof getWebSearchOverrideTargetCandidatesCall>>
	>([]);

	useEffect(() => {
		if (!accessToken) {
			return;
		}
		getGeneralSettingsCall(accessToken).then((data) => {
			setGeneralSettings(data);
		});
		getWebSearchOverrideTargetCandidatesCall(accessToken)
			.then(setWebSearchCandidates)
			.catch(() => setWebSearchCandidates([]));
	}, [accessToken]);

	const handleInputChange = (fieldName: string, newValue: any) => {
		// Update the value in the state
		const updatedSettings = generalSettings.map((setting) =>
			setting.field_name === fieldName ? { ...setting, field_value: newValue } : setting,
		);
		setGeneralSettings(updatedSettings);
	};

	const handleUpdateField = (fieldName: string, idx: number) => {
		if (!accessToken) {
			return;
		}

		let fieldValue = generalSettings[idx].field_value;

		if (fieldValue == null || fieldValue == undefined) {
			return;
		}
		try {
			updateConfigFieldSetting(accessToken, fieldName, fieldValue);
			// update value in state

			const updatedSettings = generalSettings.map((setting) =>
				setting.field_name === fieldName ? { ...setting, stored_in_db: true } : setting,
			);
			setGeneralSettings(updatedSettings);
		} catch (error) {
			// do something
		}
	};

	const handleResetField = (fieldName: string, idx: number) => {
		if (!accessToken) {
			return;
		}

		try {
			deleteConfigFieldSetting(accessToken, fieldName);
			// update value in state

			const updatedSettings = generalSettings.map((setting) =>
				setting.field_name === fieldName ? { ...setting, stored_in_db: null, field_value: null } : setting,
			);
			setGeneralSettings(updatedSettings);
		} catch (error) {
			// do something
		}
	};

	if (!accessToken) {
		return null;
	}

	return (
		<div className="w-full">
			<TabGroup className="h-[75vh] w-full">
				<TabList variant="line" defaultValue="1" className="px-8 pt-4">
					<Tab value="1">Loadbalancing</Tab>
					<Tab value="2">Fallbacks</Tab>
					<Tab value="3">General</Tab>
				</TabList>
				<TabPanels className="px-8 py-6">
					<TabPanel>
						<RouterSettings accessToken={accessToken} userRole={userRole} userID={userID} modelData={modelData} />
					</TabPanel>
					<TabPanel>
						<Fallbacks accessToken={accessToken} userRole={userRole} userID={userID} modelData={modelData} />
					</TabPanel>
					<TabPanel>
						<Card>
							<Table>
								<TableHead>
									<TableRow>
										<TableHeaderCell>Setting</TableHeaderCell>
										<TableHeaderCell>Value</TableHeaderCell>
										<TableHeaderCell>Status</TableHeaderCell>
										<TableHeaderCell>Action</TableHeaderCell>
									</TableRow>
								</TableHead>
								<TableBody>
									{generalSettings
										.filter((value) => value.field_type !== "TypedDictionary")
										.map((value, index) => (
											<TableRow key={index}>
												<TableCell>
													<Text>{value.field_name}</Text>
													<p
														style={{
															fontSize: "0.65rem",
															color: "#808080",
															fontStyle: "italic",
														}}
														className="mt-1"
													>
														{value.field_description}
													</p>
												</TableCell>
												<TableCell>
													{value.field_type == "Integer" ? (
														<InputNumber
															step={1}
															value={value.field_value}
															onChange={(newValue) => handleInputChange(value.field_name, newValue)}
														/>
													) : value.field_type == "Boolean" ? (
														<Switch
															checked={value.field_value === true || value.field_value === "true"}
															onChange={(checked) => handleInputChange(value.field_name, checked)}
														/>
													) : value.field_type == "String" && value.field_name === "websearch_override_target_model" ? (
														<Select
															showSearch
															value={value.field_value ?? undefined}
															options={webSearchCandidates.map((candidate) => ({
																value: candidate.model_name,
																label: `${candidate.type === "alias" ? "Alias" : "模型"}: ${candidate.model_name}`,
															}))}
															disabled={webSearchCandidates.length === 0}
															onChange={(newValue) => handleInputChange(value.field_name, newValue)}
															filterOption={(input, option) =>
																String(option?.label ?? "")
																	.toLowerCase()
																	.includes(input.toLowerCase())
															}
														/>
													) : value.field_type == "String" ? (
														<Input
															value={value.field_value ?? ""}
															onChange={(event) => handleInputChange(value.field_name, event.target.value)}
														/>
													) : null}
												</TableCell>
												<TableCell>
													{value.stored_in_db == true ? (
														<Badge icon={CheckCircleIcon} className="text-white">
															In DB
														</Badge>
													) : value.stored_in_db == false ? (
														<Badge className="text-gray bg-white outline">In Config</Badge>
													) : (
														<Badge className="text-gray bg-white outline">Not Set</Badge>
													)}
												</TableCell>
												<TableCell>
													<Button onClick={() => handleUpdateField(value.field_name, index)}>Update</Button>
													<Icon icon={TrashIcon} color="red" onClick={() => handleResetField(value.field_name, index)}>
														Reset
													</Icon>
												</TableCell>
											</TableRow>
										))}
								</TableBody>
							</Table>
						</Card>
					</TabPanel>
				</TabPanels>
			</TabGroup>
		</div>
	);
};

export default GeneralSettings;
