import { useMoneyFormatter } from "@/contexts/PriceDisplay";
import { useMemo, useState } from "react";
import { Button, Form, Select, Tooltip } from "antd";
import { TextInput } from "@tremor/react";
import { InfoCircleOutlined } from "@ant-design/icons";
import { useCliProxyModels } from "@/app/(dashboard)/hooks/models/useCliProxyModels";
import { useModelCostMap } from "@/app/(dashboard)/hooks/models/useModelCostMap";
import NumericalInput from "../shared/numerical_input";
import type { CredentialValues } from "../networking";
import ProviderSelect from "../common_components/ProviderSelect";
import { provider_map } from "../provider_info_helpers";
import ModelSettingField from "./ModelSettingField";
import ModelValueList from "./ModelValueList";

interface ModelBasicSettingsProps {
	editing: boolean;
	modelData: any;
	modelAccessGroups: string[] | null;
	credentialValues?: CredentialValues;
	availableModelNames: string[];
}

const ANTHROPIC_REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
const CODEX_REASONING_EFFORTS = ["minimal", ...ANTHROPIC_REASONING_EFFORTS] as const;

function isCodexReasoningModel(provider: unknown, model: unknown): boolean {
	const providerName = typeof provider === "string" ? provider.toLowerCase() : "";
	const modelName = typeof model === "string" ? model.toLowerCase().replace(/^cliproxy\//, "") : "";
	if (providerName === "anthropic" || modelName.includes("claude")) {
		return false;
	}
	return (
		providerName === "openai" ||
		providerName === "cliproxy" ||
		modelName.includes("codex") ||
		modelName.startsWith("gpt-") ||
		/^o\d/.test(modelName)
	);
}

function toSuggestionOptions(values: Array<string | undefined>): Array<{ value: string; label: string }> {
	const seen = new Set<string>();
	const options: Array<{ value: string; label: string }> = [];
	for (const value of values) {
		if (typeof value !== "string" || value.trim() === "" || seen.has(value)) {
			continue;
		}
		seen.add(value);
		options.push({ value, label: value });
	}
	return options;
}

interface SuggestionInputProps {
	value?: string;
	onChange?: (value: string) => void;
	options: Array<{ value: string; label: string }>;
	placeholder: string;
	ariaLabel: string;
	customPlaceholder: string;
}

const CUSTOM_SUGGESTION_VALUE = "__custom__";

/**
 * 可选择已知候选、也可输入任意新值的单值字段。
 *
 * 与 Add Model 的 LiteLLM Model Name 一致：候选项覆盖已知取值，任意自定义值通过
 * "自定义取值" 选项切换到输入框，避免候选列表变成取值限制。
 */
function SuggestionInput({ value, onChange, options, placeholder, ariaLabel, customPlaceholder }: SuggestionInputProps) {
	const [customActive, setCustomActive] = useState(false);
	const current = typeof value === "string" ? value : "";
	const selectOptions = useMemo(() => {
		const merged = [...toSuggestionOptions([current]), ...options];
		const seen = new Set<string>();
		const unique: Array<{ value: string; label: string }> = [];
		for (const option of merged) {
			if (seen.has(option.value)) {
				continue;
			}
			seen.add(option.value);
			unique.push(option);
		}
		// 自定义入口放在首位，避免长候选列表把它挤到需要滚动才可见的位置。
		return [{ value: CUSTOM_SUGGESTION_VALUE, label: "自定义取值（手动输入）" }, ...unique];
	}, [current, options]);

	if (customActive) {
		return (
			<div className="space-y-1">
				<TextInput value={current} onChange={(event) => onChange?.(event.target.value)} placeholder={customPlaceholder} />
				<Button type="link" size="small" className="px-0" onClick={() => setCustomActive(false)}>
					从已知候选中选择
				</Button>
			</div>
		);
	}

	return (
		<Select
			showSearch
			allowClear
			value={current === "" ? undefined : current}
			onChange={(next?: string) => {
				if (next === CUSTOM_SUGGESTION_VALUE) {
					setCustomActive(true);
					return;
				}
				onChange?.(next ?? "");
			}}
			options={selectOptions}
			optionFilterProp="label"
			aria-label={ariaLabel}
			placeholder={placeholder}
			style={{ width: "100%" }}
		/>
	);
}

function CredentialValue({ value, format = String }: { value: unknown; format?: (value: any) => string }) {
	return (
		<span className="text-gray-400">
			{format(value)}
			<span className="ml-1 text-xs">(from Credentials)</span>
		</span>
	);
}

export default function ModelBasicSettings({
	editing,
	modelData,
	modelAccessGroups,
	credentialValues,
	availableModelNames,
}: ModelBasicSettingsProps) {
	const formatMoney = useMoneyFormatter();
	const form = Form.useFormInstance();
	const litellmParams = modelData.litellm_params ?? {};
	const modelInfo = modelData.model_info ?? {};
	const watchedProvider = Form.useWatch("custom_llm_provider", form);
	const watchedModel = Form.useWatch("litellm_model_name", form);
	const watchedModelGroup = Form.useWatch("model_name", form);
	const reasoningEfforts = isCodexReasoningModel(
		editing ? watchedProvider ?? litellmParams.custom_llm_provider : litellmParams.custom_llm_provider,
		editing ? watchedModel ?? modelData.litellm_model_name : modelData.litellm_model_name,
	)
		? CODEX_REASONING_EFFORTS
		: ANTHROPIC_REASONING_EFFORTS;
	// Model Name / LiteLLM Model Name 的候选只是补全来源，任意自定义值仍可保存。
	const activeProvider = editing ? watchedProvider ?? litellmParams.custom_llm_provider : litellmParams.custom_llm_provider;
	const providerSlug = typeof activeProvider === "string" ? activeProvider.toLowerCase() : "";
	const isCliProxyProvider = providerSlug === provider_map.CLIProxy.toLowerCase();
	const currentModelName = editing ? watchedModel ?? modelData.litellm_model_name : modelData.litellm_model_name;
	const { data: modelCostMapData } = useModelCostMap(editing);
	const { data: cliProxyModels } = useCliProxyModels(editing && isCliProxyProvider);

	// Model Name 是 model group 名，可直接从已有 model group 里补全，也允许新名字。
	const currentModelGroupName = editing ? watchedModelGroup ?? modelData.model_name : modelData.model_name;
	const modelGroupOptions = useMemo(
		() => toSuggestionOptions([currentModelGroupName, ...availableModelNames]),
		[currentModelGroupName, availableModelNames],
	);

	const modelNameOptions = useMemo(() => {
		if (isCliProxyProvider) {
			const cliProxyCandidates = (cliProxyModels ?? [])
				.map((model) => `cliproxy/${model}`)
				.sort((left, right) => left.localeCompare(right));
			return toSuggestionOptions([currentModelName, ...cliProxyCandidates]);
		}
		if (providerSlug === "") {
			return toSuggestionOptions([currentModelName]);
		}
		// 与 ProviderSelect 一致，按 litellm_provider 从模型价格表筛选该 provider 的已知模型；
		// vertex_ai-* / bedrock_* 这类同族 slug 一并纳入，其它 provider 前缀（如 azure_openai）不会误入。
		const matchesProvider = (litellmProvider: unknown) =>
			typeof litellmProvider === "string" &&
			(litellmProvider === providerSlug ||
				litellmProvider.startsWith(`${providerSlug}_`) ||
				litellmProvider.startsWith(`${providerSlug}-`));
		const candidates = Object.entries(modelCostMapData ?? {})
			.filter(([, entry]) => typeof entry === "object" && entry !== null)
			.filter(([, entry]) => matchesProvider((entry as { litellm_provider?: unknown }).litellm_provider))
			.map(([modelName]) => modelName)
			.sort((left, right) => left.localeCompare(right));
		return toSuggestionOptions([currentModelName, ...candidates]);
	}, [isCliProxyProvider, providerSlug, modelCostMapData, cliProxyModels, currentModelName]);

	const hasCredentialValue = (key: string) =>
		credentialValues !== undefined && Object.prototype.hasOwnProperty.call(credentialValues, key);
	const resolvedValue = (key: string, fallback: React.ReactNode, format?: (value: any) => string) =>
		hasCredentialValue(key) ? <CredentialValue value={credentialValues?.[key]} format={format} /> : fallback;
	const resolvedEditor = (key: string, editor: React.ReactNode, format?: (value: any) => string) =>
		hasCredentialValue(key) ? (
			<>
				<div className="hidden">{editor}</div>
				<div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
					<CredentialValue value={credentialValues?.[key]} format={format} />
				</div>
			</>
		) : (
			editor
		);

	return (
		<>
			<ModelSettingField
				label="Model Name"
				editing={editing}
				editor={
					<Form.Item name="model_name" className="mb-0">
						<SuggestionInput
							ariaLabel="Model Name"
							placeholder="Enter model name"
							options={modelGroupOptions}
							customPlaceholder="Enter model name"
						/>
					</Form.Item>
				}
			>
				{modelData.model_name}
			</ModelSettingField>
			<ModelSettingField
				label="LiteLLM Model Name"
				editing={editing}
				editor={resolvedEditor(
					"model",
					<Form.Item name="litellm_model_name" className="mb-0">
						<SuggestionInput
							ariaLabel="LiteLLM Model Name"
							placeholder="Enter LiteLLM model name"
							options={modelNameOptions}
							customPlaceholder="Enter LiteLLM model name"
						/>
					</Form.Item>,
				)}
			>
				{resolvedValue("model", modelData.litellm_model_name)}
			</ModelSettingField>
			<ModelSettingField
				label={
					<>
						Model Override
						<Tooltip title="Always route requests for this model to the selected target first, then fall back along the chain configured on that target.">
							<InfoCircleOutlined className="ml-1" />
						</Tooltip>
					</>
				}
				editing={editing}
				editor={
					<Form.Item name="override_model_name" className="mb-0">
						<Select
							showSearch
							allowClear
							placeholder="No override"
							optionFilterProp="label"
							options={availableModelNames
								.filter((name) => name !== modelData.model_name)
								.map((name) => ({ value: name, label: name }))}
						/>
					</Form.Item>
				}
			>
				{modelInfo.override_model_name || "Not Set"}
			</ModelSettingField>
			<ModelSettingField
				label={
					<>
						Override Reasoning Effort
						<Tooltip title="When set, replaces the caller's reasoning effort on the final request sent to the model server.">
							<InfoCircleOutlined className="ml-1" />
						</Tooltip>
					</>
				}
				editing={editing}
				editor={
					<Form.Item name="override_reasoning_effort" className="mb-0">
						<Select
							allowClear
							aria-label="Override Reasoning Effort"
							placeholder="Preserve request value"
							options={reasoningEfforts.map((effort) => ({ value: effort, label: effort }))}
						/>
					</Form.Item>
				}
			>
				{modelInfo.override_reasoning_effort || "Not Set"}
			</ModelSettingField>
			<ModelSettingField
				label={editing ? "Input Cost (USD / 1M tokens)" : "Input Cost (per 1M tokens)"}
				editing={editing}
				editor={resolvedEditor(
					"input_cost_per_token",
					<Form.Item name="input_cost" className="mb-0">
						<NumericalInput placeholder="Enter input cost" />
					</Form.Item>,
					(value) =>
						editing
							? "$" + (Number(value) * 1_000_000).toFixed(4)
							: formatMoney(Number(value) * 1_000_000, 4, modelData),
				)}
			>
				{resolvedValue(
					"input_cost_per_token",
					litellmParams.input_cost_per_token != null
						? formatMoney(litellmParams.input_cost_per_token * 1_000_000, 4, modelData)
						: modelInfo.input_cost_per_token != null
							? formatMoney(modelInfo.input_cost_per_token * 1_000_000, 4, modelData)
							: "Not Set",
					(value) =>
						editing
							? "$" + (Number(value) * 1_000_000).toFixed(4)
							: formatMoney(Number(value) * 1_000_000, 4, modelData),
				)}
			</ModelSettingField>
			<ModelSettingField
				label={editing ? "Output Cost (USD / 1M tokens)" : "Output Cost (per 1M tokens)"}
				editing={editing}
				editor={resolvedEditor(
					"output_cost_per_token",
					<Form.Item name="output_cost" className="mb-0">
						<NumericalInput placeholder="Enter output cost" />
					</Form.Item>,
					(value) =>
						editing
							? "$" + (Number(value) * 1_000_000).toFixed(4)
							: formatMoney(Number(value) * 1_000_000, 4, modelData),
				)}
			>
				{resolvedValue(
					"output_cost_per_token",
					litellmParams.output_cost_per_token != null
						? formatMoney(litellmParams.output_cost_per_token * 1_000_000, 4, modelData)
						: modelInfo.output_cost_per_token != null
							? formatMoney(modelInfo.output_cost_per_token * 1_000_000, 4, modelData)
							: "Not Set",
					(value) =>
						editing
							? "$" + (Number(value) * 1_000_000).toFixed(4)
							: formatMoney(Number(value) * 1_000_000, 4, modelData),
				)}
			</ModelSettingField>
			<ModelSettingField
				label="API Base"
				editing={editing}
				editor={resolvedEditor(
					"api_base",
					<Form.Item name="api_base" className="mb-0">
						<TextInput placeholder="Enter API base" />
					</Form.Item>,
				)}
			>
				{resolvedValue("api_base", litellmParams.api_base || "Not Set")}
			</ModelSettingField>
			<ModelSettingField
				label="Custom LLM Provider"
				editing={editing}
				editor={resolvedEditor(
					"custom_llm_provider",
					<Form.Item name="custom_llm_provider" className="mb-0">
						<ProviderSelect
							valueField="litellm_provider"
							allowClear
							aria-label="Custom LLM Provider"
							placeholder="Select a provider"
							onChange={(provider) => {
								if (provider === "cliproxy") {
									form.setFieldsValue({
										api_base: "",
										api_key: "",
										delete_api_key: true,
										litellm_credential_name: "",
									});
								}
							}}
						/>
					</Form.Item>,
				)}
			>
				{resolvedValue("custom_llm_provider", litellmParams.custom_llm_provider || "Not Set")}
			</ModelSettingField>
			<ModelSettingField
				label="Organization"
				editing={editing}
				editor={resolvedEditor(
					"organization",
					<Form.Item name="organization" className="mb-0">
						<TextInput placeholder="Enter organization" />
					</Form.Item>,
				)}
			>
				{resolvedValue("organization", litellmParams.organization || "Not Set")}
			</ModelSettingField>
			<ModelSettingField
				label="TPM (Tokens per Minute)"
				editing={editing}
				editor={resolvedEditor(
					"tpm",
					<Form.Item name="tpm" className="mb-0">
						<NumericalInput placeholder="Enter TPM" />
					</Form.Item>,
				)}
			>
				{resolvedValue("tpm", litellmParams.tpm ?? "Not Set")}
			</ModelSettingField>
			<ModelSettingField
				label="RPM (Requests per Minute)"
				editing={editing}
				editor={resolvedEditor(
					"rpm",
					<Form.Item name="rpm" className="mb-0">
						<NumericalInput placeholder="Enter RPM" />
					</Form.Item>,
				)}
			>
				{resolvedValue("rpm", litellmParams.rpm ?? "Not Set")}
			</ModelSettingField>
			<ModelSettingField
				label="Max Retries"
				editing={editing}
				editor={resolvedEditor(
					"max_retries",
					<Form.Item name="max_retries" className="mb-0">
						<NumericalInput placeholder="Enter max retries" />
					</Form.Item>,
				)}
			>
				{resolvedValue("max_retries", litellmParams.max_retries ?? "Not Set")}
			</ModelSettingField>
			<ModelSettingField
				label="Timeout (seconds)"
				editing={editing}
				editor={resolvedEditor(
					"timeout",
					<Form.Item name="timeout" className="mb-0">
						<NumericalInput placeholder="Enter timeout" />
					</Form.Item>,
				)}
			>
				{resolvedValue("timeout", litellmParams.timeout ?? "Not Set")}
			</ModelSettingField>
			<ModelSettingField
				label="Stream Timeout (seconds)"
				editing={editing}
				editor={resolvedEditor(
					"stream_timeout",
					<Form.Item name="stream_timeout" className="mb-0">
						<NumericalInput placeholder="Enter stream timeout" />
					</Form.Item>,
				)}
			>
				{resolvedValue("stream_timeout", litellmParams.stream_timeout ?? "Not Set")}
			</ModelSettingField>
			<ModelSettingField
				label="Model Access Groups"
				editing={editing}
				fullWidth
				editor={
					<Form.Item name="model_access_group" className="mb-0">
						<Select
							mode="tags"
							showSearch
							placeholder="Select existing groups or type to create new ones"
							optionFilterProp="children"
							tokenSeparators={[","]}
							maxTagCount="responsive"
							allowClear
							style={{ width: "100%" }}
							options={modelAccessGroups?.map((group) => ({ value: group, label: group }))}
						/>
					</Form.Item>
				}
			>
				<ModelValueList
					value={modelInfo.access_groups}
					emptyLabel="No groups assigned"
					pillClassName="bg-blue-100 text-blue-800"
				/>
			</ModelSettingField>
		</>
	);
}
