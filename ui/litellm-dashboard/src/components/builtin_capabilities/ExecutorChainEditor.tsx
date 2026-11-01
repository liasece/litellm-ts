"use client";

import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, InputNumber, Select, Switch, Tooltip, Typography } from "antd";
import type {
	BuiltinCapabilityDeepSeekToolsExecutor,
	BuiltinCapabilityExecutor,
	BuiltinCapabilityModelExecutor,
} from "../networking";

const { Text } = Typography;

/** 执行者类型选择项的展示文案。 */
const EXECUTOR_TYPE_OPTIONS = [
	{ label: "LiteLLM model", value: "model" },
	{ label: "DeepSeek Search & Fetch (direct)", value: "deepseek_tools" },
];

/** 新建 DeepSeek 直连执行者时的初始参数。 */
export function createDeepSeekExecutor(credentialName = ""): BuiltinCapabilityDeepSeekToolsExecutor {
	return {
		type: "deepseek_tools",
		api_base: "https://api.deepseek.com",
		credential_name: credentialName,
		timeout_ms: 15000,
		search_count: 10,
		search_need_content: false,
		localization: "",
	};
}

/**
 * 切换执行者类型时只保留可复用字段。
 * @param nextType - 目标类型
 * @param current - 当前执行者
 */
export function convertExecutor(
	nextType: "model" | "deepseek_tools",
	current: Partial<BuiltinCapabilityExecutor>,
): BuiltinCapabilityExecutor {
	if (nextType === "model") {
		const model: BuiltinCapabilityModelExecutor = {
			type: "model",
			model: current.type === "model" ? (current.model ?? "") : "",
		};
		if (current.type === "model" && current.max_output_tokens !== undefined) {
			model.max_output_tokens = current.max_output_tokens;
		}
		return model;
	}
	return createDeepSeekExecutor(current.type === "deepseek_tools" ? current.credential_name : "");
}

interface ExecutorChainEditorProps {
	/** 执行链的当前值。 */
	value?: BuiltinCapabilityExecutor[];
	/** 值变化回调。 */
	onChange?: (value: BuiltinCapabilityExecutor[]) => void;
	/** 可选的路由模型名。 */
	modelOptions: Array<{ label: string; value: string }>;
	/** 可选的命名 Credential。 */
	credentialOptions: Array<{ label: string; value: string }>;
	/** 是否允许添加直连执行者（仅 web capability）。 */
	allowDeepSeekTools: boolean;
	/** 无执行者时的提示文案。 */
	emptyHint: string;
}

/**
 * 有序执行链编辑器。
 *
 * 执行链是一个显式顺序的列表：元素按顺序尝试，失败后继续下一个。
 * 每个元素可以是可路由模型，也可以是直连上游工具接口的客户端；
 * 两类元素各有自己的参数，切换类型时只保留通用字段。
 * @param props
 */
export default function ExecutorChainEditor({
	value,
	onChange,
	modelOptions,
	credentialOptions,
	allowDeepSeekTools,
	emptyHint,
}: ExecutorChainEditorProps) {
	const executors = value ?? [];

	const replace = (index: number, next: BuiltinCapabilityExecutor) => {
		onChange?.(executors.map((executor, position) => (position === index ? next : executor)));
	};

	const remove = (index: number) => {
		onChange?.(executors.filter((_, position) => position !== index));
	};

	const move = (index: number, direction: -1 | 1) => {
		const target = index + direction;
		if (target < 0 || target >= executors.length) {
			return;
		}
		const next = [...executors];
		const moving = next[index]!;
		next[index] = next[target]!;
		next[target] = moving;
		onChange?.(next);
	};

	const add = (type: "model" | "deepseek_tools") => {
		onChange?.([...executors, convertExecutor(type, {})]);
	};

	return (
		<div className="space-y-3">
			{executors.length === 0 ? (
				<Text type="secondary">{emptyHint}</Text>
			) : (
				executors.map((executor, index) => (
					<div key={index} className="rounded-lg border border-gray-200 p-3">
						<div className="mb-3 flex items-center justify-between gap-3">
							<div className="flex items-center gap-2">
								<Text type="secondary" className="text-xs">
									#{index + 1}
								</Text>
								<Select
									aria-label={`Executor type ${index + 1}`}
									style={{ width: 288 }}
									value={executor.type}
									options={EXECUTOR_TYPE_OPTIONS.filter(
										(option) => allowDeepSeekTools || option.value !== "deepseek_tools",
									)}
									onChange={(nextType) => replace(index, convertExecutor(nextType, executor))}
								/>
							</div>
							<div className="flex items-center gap-1">
								<Tooltip title="Move up">
									<Button
										size="small"
										aria-label={`Move executor ${index + 1} up`}
										disabled={index === 0}
										onClick={() => move(index, -1)}
									>
										↑
									</Button>
								</Tooltip>
								<Tooltip title="Move down">
									<Button
										size="small"
										aria-label={`Move executor ${index + 1} down`}
										disabled={index === executors.length - 1}
										onClick={() => move(index, 1)}
									>
										↓
									</Button>
								</Tooltip>
								<Tooltip title="Remove">
									<Button
										size="small"
										aria-label={`Remove executor ${index + 1}`}
										icon={<DeleteOutlined />}
										onClick={() => remove(index)}
									/>
								</Tooltip>
							</div>
						</div>

						{executor.type === "model" ? (
							<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
								<div>
									<Text type="secondary" className="mb-1 block text-xs">
										Model
									</Text>
									<Select
										aria-label={`Model for executor ${index + 1}`}
										style={{ width: "100%" }}
										showSearch
										allowClear
										optionFilterProp="label"
										options={modelOptions}
										value={executor.model || undefined}
										placeholder="Select a routable model"
										onChange={(model: string) => replace(index, { ...executor, model: model ?? "" })}
									/>
								</div>
								<div>
									<Text type="secondary" className="mb-1 block text-xs">
										Output token limit (optional)
									</Text>
									<InputNumber
										aria-label={`Output token limit for executor ${index + 1}`}
										style={{ width: "100%" }}
										min={128}
										step={128}
										value={executor.max_output_tokens}
										placeholder="Uses the capability default"
										onChange={(maxOutputTokens) =>
											replace(index, {
												...executor,
												...(typeof maxOutputTokens === "number" ? { max_output_tokens: maxOutputTokens } : {}),
											})
										}
									/>
								</div>
							</div>
						) : (
							<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
								<div>
									<Text type="secondary" className="mb-1 block text-xs">
										Credential
									</Text>
									<Select
										aria-label={`Credential for executor ${index + 1}`}
										style={{ width: "100%" }}
										showSearch
										allowClear
										optionFilterProp="label"
										options={credentialOptions}
										value={executor.credential_name || undefined}
										placeholder="Select a stored DeepSeek credential"
										onChange={(credentialName: string) =>
											replace(index, { ...executor, credential_name: credentialName ?? "" })
										}
									/>
								</div>
								<div>
									<Text type="secondary" className="mb-1 block text-xs">
										API base
									</Text>
									<Select
										aria-label={`API base for executor ${index + 1}`}
										style={{ width: "100%" }}
										mode="tags"
										maxCount={1}
										value={[executor.api_base]}
										options={[
											{ label: "https://api.deepseek.com", value: "https://api.deepseek.com" },
										]}
										onChange={(next: string[]) =>
											replace(index, { ...executor, api_base: next[next.length - 1] ?? "" })
										}
									/>
								</div>
								<div>
									<Text type="secondary" className="mb-1 block text-xs">
										Results per search
									</Text>
									<InputNumber
										aria-label={`Search result count for executor ${index + 1}`}
										style={{ width: "100%" }}
										min={1}
										max={50}
										value={executor.search_count}
										onChange={(searchCount) =>
											replace(index, {
												...executor,
												search_count: typeof searchCount === "number" ? searchCount : 10,
											})
										}
									/>
								</div>
								<div>
									<Text type="secondary" className="mb-1 block text-xs">
										Request timeout (ms)
									</Text>
									<InputNumber
										aria-label={`Timeout for executor ${index + 1}`}
										style={{ width: "100%" }}
										min={1000}
										max={120000}
										step={1000}
										value={executor.timeout_ms}
										onChange={(timeoutMs) =>
											replace(index, {
												...executor,
												timeout_ms: typeof timeoutMs === "number" ? timeoutMs : 15000,
											})
										}
									/>
								</div>
								<div className="flex items-center justify-between gap-3">
									<Text type="secondary" className="text-xs">
										Include full page content in results
									</Text>
									<Switch
										aria-label={`Include content for executor ${index + 1}`}
										checked={executor.search_need_content}
										onChange={(searchNeedContent) =>
											replace(index, { ...executor, search_need_content: searchNeedContent })
										}
									/>
								</div>
								<div>
									<Text type="secondary" className="mb-1 block text-xs">
										Localization (optional)
									</Text>
									<Select
										aria-label={`Localization for executor ${index + 1}`}
										style={{ width: "100%" }}
										mode="tags"
										maxCount={1}
										value={executor.localization ? [executor.localization] : []}
										options={[]}
										placeholder="e.g. CN"
										onChange={(next: string[]) =>
											replace(index, { ...executor, localization: next[0] ?? "" })
										}
									/>
								</div>
							</div>
						)}
					</div>
				))
			)}

			<div className="flex flex-wrap items-center gap-2">
				<Button size="small" icon={<PlusOutlined />} onClick={() => add("model")}>
					Add model executor
				</Button>
				{allowDeepSeekTools ? (
					<Button size="small" icon={<PlusOutlined />} onClick={() => add("deepseek_tools")}>
						Add DeepSeek Search &amp; Fetch
					</Button>
				) : null}
			</div>
		</div>
	);
}
