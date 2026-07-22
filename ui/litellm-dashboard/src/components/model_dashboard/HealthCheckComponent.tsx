import React, { useMemo, useState } from "react";
import { Title, Text, Button, Badge } from "@tremor/react";
import { Button as AntdButton, Modal } from "antd";
import { ModelDataTable } from "./table";
import { healthCheckColumns } from "./health_check_columns";
import { Team } from "../key_team_helpers/key_list";
import { useDeploymentHealth } from "./useDeploymentHealth";

interface HealthCheckComponentProps {
	accessToken: string | null;
	modelData: any;
	all_models_on_proxy: string[];
	getDisplayModelName: (model: any) => string;
	setSelectedModelId?: (modelId: string) => void;
	teams?: Team[] | null;
}

const HealthCheckComponent: React.FC<HealthCheckComponentProps> = ({
	accessToken,
	modelData,
	all_models_on_proxy,
	getDisplayModelName,
	setSelectedModelId,
	teams,
}) => {
	const deploymentIds = useMemo(
		() =>
			modelData?.data
				?.map((model: any) => model.model_info?.id)
				.filter((id: unknown): id is string => typeof id === "string") ?? [],
		[modelData],
	);
	const { statuses, runAll, runOne, runSelected } = useDeploymentHealth(accessToken, deploymentIds);
	const [selectedModelsForHealth, setSelectedModelsForHealth] = useState<string[]>([]);
	const [allModelsSelected, setAllModelsSelected] = useState(false);
	const [errorModalVisible, setErrorModalVisible] = useState(false);
	const [selectedErrorDetails, setSelectedErrorDetails] = useState<{
		modelName: string;
		cleanedError: string;
		fullError: string;
	} | null>(null);
	const [successModalVisible, setSuccessModalVisible] = useState(false);
	const [selectedSuccessDetails, setSelectedSuccessDetails] = useState<{ modelName: string; response: unknown } | null>(
		null,
	);

	const handleRunAll = async () => {
		const modelsToCheck = selectedModelsForHealth.length > 0 ? selectedModelsForHealth : all_models_on_proxy;
		if (modelsToCheck.length === 0) {
			Modal.warning({ title: "No deployments available", content: "Add a deployment before running health checks." });
			return;
		}
		if (selectedModelsForHealth.length > 0 && selectedModelsForHealth.length < all_models_on_proxy.length) {
			await runSelected(modelsToCheck);
			return;
		}
		await runAll();
	};

	const handleModelSelection = (modelId: string, checked: boolean) => {
		setSelectedModelsForHealth((previous) =>
			checked ? [...previous, modelId] : previous.filter((id) => id !== modelId),
		);
		if (!checked) setAllModelsSelected(false);
	};

	const handleSelectAll = (checked: boolean) => {
		setAllModelsSelected(checked);
		setSelectedModelsForHealth(checked ? all_models_on_proxy : []);
	};

	const getStatusBadge = (status: string) => {
		switch (status) {
			case "healthy":
				return <Badge color="emerald">healthy</Badge>;
			case "unhealthy":
				return <Badge color="red">unhealthy</Badge>;
			case "checking":
				return <Badge color="blue">checking</Badge>;
			case "none":
				return <Badge color="gray">none</Badge>;
			default:
				return <Badge color="gray">unknown</Badge>;
		}
	};

	const showErrorModal = (modelName: string, cleanedError: string, fullError: string) => {
		setSelectedErrorDetails({ modelName, cleanedError, fullError });
		setErrorModalVisible(true);
	};
	const showSuccessModal = (modelName: string, response: unknown) => {
		setSelectedSuccessDetails({ modelName, response });
		setSuccessModalVisible(true);
	};

	return (
		<div>
			<div className="mb-6">
				<div className="flex justify-between items-center">
					<div>
						<Title>Model Health Status</Title>
						<Text className="text-gray-600 mt-1">
							Run health checks on individual models to verify they are working correctly
						</Text>
					</div>
					<div className="flex items-center gap-3">
						{selectedModelsForHealth.length > 0 && (
							<Button size="sm" variant="light" onClick={() => handleSelectAll(false)} className="px-3 py-1 text-sm">
								Clear Selection
							</Button>
						)}
						<Button
							size="sm"
							variant="secondary"
							onClick={handleRunAll}
							disabled={Object.values(statuses).some((status) => status.loading)}
							className="px-3 py-1 text-sm"
						>
							{selectedModelsForHealth.length > 0 && selectedModelsForHealth.length < all_models_on_proxy.length
								? "Run Selected Checks"
								: "Run All Checks"}
						</Button>
					</div>
				</div>
			</div>

			<ModelDataTable
				columns={healthCheckColumns(
					statuses,
					selectedModelsForHealth,
					allModelsSelected,
					handleModelSelection,
					handleSelectAll,
					runOne,
					getStatusBadge,
					getDisplayModelName,
					showErrorModal,
					showSuccessModal,
					setSelectedModelId,
					teams,
				)}
				data={(modelData?.data ?? []).map((model: any) => {
					const status = statuses[model.model_info?.id] ?? {
						status: "none",
						lastCheck: "None",
						lastSuccess: "None",
						loading: false,
					};
					return {
						model_name: model.model_name,
						model_info: model.model_info,
						provider: model.provider,
						litellm_model_name: model.litellm_model_name,
						health_status: status.status,
						last_check: status.lastCheck,
						last_success: status.lastSuccess ?? "None",
						health_loading: status.loading,
						health_error: status.error,
						health_full_error: status.fullError,
					};
				})}
				isLoading={false}
			/>

			<Modal
				title={selectedErrorDetails ? `Health Check Error - ${selectedErrorDetails.modelName}` : "Error Details"}
				open={errorModalVisible}
				onCancel={() => setErrorModalVisible(false)}
				footer={[
					<AntdButton key="close" onClick={() => setErrorModalVisible(false)}>
						Close
					</AntdButton>,
				]}
				width={800}
			>
				{selectedErrorDetails && (
					<div className="space-y-4">
						<div>
							<Text className="font-medium">Error:</Text>
							<div className="mt-2 p-3 bg-red-50 border border-red-200 rounded-md">
								<Text className="text-red-800">{selectedErrorDetails.cleanedError}</Text>
							</div>
						</div>
						<div>
							<Text className="font-medium">Full Error Details:</Text>
							<div className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded-md max-h-96 overflow-y-auto">
								<pre className="text-sm text-gray-800 whitespace-pre-wrap">{selectedErrorDetails.fullError}</pre>
							</div>
						</div>
					</div>
				)}
			</Modal>
			<Modal
				title={
					selectedSuccessDetails ? `Health Check Response - ${selectedSuccessDetails.modelName}` : "Response Details"
				}
				open={successModalVisible}
				onCancel={() => setSuccessModalVisible(false)}
				footer={[
					<AntdButton key="close" onClick={() => setSuccessModalVisible(false)}>
						Close
					</AntdButton>,
				]}
				width={800}
			>
				{selectedSuccessDetails && (
					<div className="space-y-4">
						<div>
							<Text className="font-medium">Status:</Text>
							<div className="mt-2 p-3 bg-green-50 border border-green-200 rounded-md">
								<Text className="text-green-800">Health check passed successfully</Text>
							</div>
						</div>
						<div>
							<Text className="font-medium">Response Details:</Text>
							<div className="mt-2 p-3 bg-gray-50 border border-gray-200 rounded-md max-h-96 overflow-y-auto">
								<pre className="text-sm text-gray-800 whitespace-pre-wrap">
									{JSON.stringify(selectedSuccessDetails.response, null, 2)}
								</pre>
							</div>
						</div>
					</div>
				)}
			</Modal>
		</div>
	);
};

export default HealthCheckComponent;
