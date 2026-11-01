import {
	CheckCircleOutlined,
	CloseCircleOutlined,
	CopyOutlined,
	EditOutlined,
	LoadingOutlined,
	PlusOutlined,
	ReloadOutlined,
} from "@ant-design/icons";
import { TrashIcon } from "@heroicons/react/outline";
import { Badge, Button, Card, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@tremor/react";
import { Input, Modal, Select, Tooltip } from "antd";
import React, { useEffect, useMemo, useState } from "react";
import { getModelGroupAliasTarget, validateModelGroupAliases } from "../../../../src/shared/ModelGroupAlias";
import type {
	ModelGroupAliasConfig,
	ModelGroupAliases,
	ModelGroupAliasValue,
	ModelGroupAliasWindow,
} from "../../../../src/shared/ModelGroupAlias";
import {
	latestHealthChecksCall,
	modelGroupHealthCheckCall,
	routableModelOptionsCall,
	setCallbacksCall,
	type RoutableModelOption,
} from "./networking";
import NotificationsManager from "./molecules/notifications_manager";

interface ModelGroupAliasSettingsProps {
	accessToken: string;
	initialModelGroupAlias?: ModelGroupAliases;
	onAliasUpdate?: (updatedAlias: ModelGroupAliases) => void;
}

interface AliasDraft {
	originalName: string | null;
	originalValue?: ModelGroupAliasValue;
	name: string;
	model: string;
	timezone: string;
	schedule: ModelGroupAliasWindow[];
}

export interface AliasResolution {
	path: string[];
	resolvedModel: string;
	reachable: boolean;
	error?: string;
}

function matchesModelName(target: string, modelNames: ReadonlySet<string>): boolean {
	if (modelNames.has(target)) return true;
	const strippedTarget = target.includes("/") ? target.slice(target.indexOf("/") + 1) : target;
	for (const modelName of modelNames) {
		if (modelName === strippedTarget) return true;
		if (!modelName.includes("*")) continue;
		const prefix = modelName.replace(/\*/g, "");
		if (target.startsWith(prefix) || strippedTarget.startsWith(prefix)) return true;
	}
	return false;
}

function objectAlias(value: ModelGroupAliasValue | undefined): ModelGroupAliasConfig | undefined {
	return value && typeof value === "object" && !Array.isArray(value) ? value : undefined;
}

type AliasHealth = {
	status: "none" | "checking" | "healthy" | "unhealthy";
	resolvedModel?: string;
	error?: string;
};

export function resolveAliasPath(
	aliasName: string,
	aliases: ModelGroupAliases,
	modelNames: ReadonlySet<string>,
	at = new Date(),
): AliasResolution {
	const path = [aliasName];
	const seen = new Set(path);
	let current = aliasName;
	while (Object.prototype.hasOwnProperty.call(aliases, current)) {
		let target: string | undefined;
		try {
			target = getModelGroupAliasTarget(aliases[current], at);
		} catch (error) {
			return {
				path,
				resolvedModel: current,
				reachable: false,
				error: error instanceof Error ? error.message : "Invalid schedule",
			};
		}
		if (target === undefined) break;
		path.push(target);
		if (seen.has(target)) {
			return { path, resolvedModel: target, reachable: false, error: `Alias cycle: ${path.join(" → ")}` };
		}
		seen.add(target);
		current = target;
	}
	const reachable = matchesModelName(current, modelNames);
	return {
		path,
		resolvedModel: current,
		reachable,
		error: reachable ? undefined : `No deployment matches “${current}”`,
	};
}

function draftValue(draft: AliasDraft): ModelGroupAliasValue {
	const model = draft.model.trim();
	const original = objectAlias(draft.originalValue);
	if (draft.schedule.length > 0) {
		return {
			...original,
			model,
			timezone: draft.timezone.trim(),
			schedule: draft.schedule.map((entry) => ({ ...entry, model: entry.model.trim() })),
		};
	}
	if (original) {
		const value = { ...original, model };
		delete value.schedule;
		delete value.timezone;
		return value;
	}
	if (Array.isArray(draft.originalValue)) {
		return [model, ...draft.originalValue.slice(1)];
	}
	return model;
}

const EMPTY_ALIASES: ModelGroupAliases = {};
const emptyHealth = (): AliasHealth => ({ status: "none" });

const ModelGroupAliasSettings: React.FC<ModelGroupAliasSettingsProps> = ({
	accessToken,
	initialModelGroupAlias = EMPTY_ALIASES,
	onAliasUpdate,
}) => {
	const [saved, setSaved] = useState({ source: initialModelGroupAlias, value: initialModelGroupAlias });
	const aliases = saved.source === initialModelGroupAlias ? saved.value : initialModelGroupAlias;
	const [editor, setEditor] = useState<AliasDraft | null>(null);
	const [formError, setFormError] = useState("");
	const [saving, setSaving] = useState(false);
	const [modelOptions, setModelOptions] = useState<RoutableModelOption[]>([]);
	const [health, setHealth] = useState<Record<string, AliasHealth>>({});
	const [checkingAll, setCheckingAll] = useState(false);
	const [now, setNow] = useState(() => new Date());

	useEffect(() => {
		let cancelled = false;
		void routableModelOptionsCall()
			.then((response) => {
				if (!cancelled) setModelOptions(response.data ?? []);
			})
			.catch((error) => {
				if (!cancelled) NotificationsManager.error(error instanceof Error ? error.message : "Failed to load models");
			});
		void latestHealthChecksCall(accessToken)
			.then((response) => {
				if (cancelled) return;
				const checks = response?.latest_health_checks;
				if (!checks || typeof checks !== "object") return;
				setHealth((previous) => {
					const next = { ...previous };
					for (const [key, value] of Object.entries(checks as Record<string, Record<string, unknown>>)) {
						if (!key.startsWith("alias:")) continue;
						next[key.slice("alias:".length)] = {
							status: value.status === "healthy" ? "healthy" : value.status === "unhealthy" ? "unhealthy" : "none",
							error: typeof value.error_message === "string" ? value.error_message : undefined,
						};
					}
					return next;
				});
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, [accessToken]);

	const hasSchedules = Object.values(aliases).some((value) => Boolean(objectAlias(value)?.schedule?.length));
	useEffect(() => {
		if (!hasSchedules) return;
		let timer: ReturnType<typeof setTimeout>;
		const tick = () => {
			setNow(new Date());
			timer = setTimeout(tick, 60_000 - (Date.now() % 60_000));
		};
		tick();
		const onVisible = () => {
			if (document.visibilityState === "visible") {
				clearTimeout(timer);
				tick();
			}
		};
		document.addEventListener("visibilitychange", onVisible);
		return () => {
			clearTimeout(timer);
			document.removeEventListener("visibilitychange", onVisible);
		};
	}, [hasSchedules]);

	const modelNames = useMemo(
		() => new Set(modelOptions.filter((option) => option.type === "model").map((option) => option.model_name)),
		[modelOptions],
	);
	const resolutions = useMemo(
		() =>
			Object.fromEntries(Object.keys(aliases).map((name) => [name, resolveAliasPath(name, aliases, modelNames, now)])),
		[aliases, modelNames, now],
	);
	const targetOptions = useMemo(() => {
		const values = new Set(modelOptions.map((option) => option.model_name));
		for (const [name, value] of Object.entries(aliases)) {
			values.add(name);
			const config = objectAlias(value);
			for (const target of config
				? [config.model, ...(config.schedule ?? []).map((entry) => entry.model)]
				: typeof value === "string"
					? [value]
					: (value as string[])) {
				values.add(target);
			}
		}
		return [...values].sort().map((value) => ({ value, label: value }));
	}, [aliases, modelOptions]);

	const saveAliases = async (updated: ModelGroupAliases): Promise<boolean> => {
		setSaving(true);
		try {
			validateModelGroupAliases(updated);
			await setCallbacksCall(accessToken, { router_settings: { model_group_alias: updated } });
			setSaved({ source: initialModelGroupAlias, value: updated });
			setHealth({});
			onAliasUpdate?.(updated);
			setNow(new Date());
			return true;
		} catch (error) {
			const message = error instanceof Error ? error.message : "Failed to save aliases";
			setFormError(message);
			NotificationsManager.error(message);
			return false;
		} finally {
			setSaving(false);
		}
	};

	const openEditor = (name?: string) => {
		const value = name === undefined ? undefined : aliases[name];
		const config = objectAlias(value);
		setFormError("");
		setEditor({
			originalName: name ?? null,
			originalValue: value,
			name: name ?? "",
			model: config?.model ?? (typeof value === "string" ? value : Array.isArray(value) ? (value[0] ?? "") : ""),
			timezone: config?.timezone ?? "Asia/Shanghai",
			schedule: config?.schedule?.map((entry) => ({ ...entry })) ?? [],
		});
	};

	const saveEditor = async () => {
		if (!editor) return;
		const name = editor.name.trim();
		if (!name || !editor.model.trim()) {
			setFormError("Alias name and default target are required");
			return;
		}
		if (name !== editor.originalName && Object.prototype.hasOwnProperty.call(aliases, name)) {
			setFormError("An alias with this name already exists");
			return;
		}
		const updated = { ...aliases };
		if (editor.originalName !== null) delete updated[editor.originalName];
		// Object.fromEntries also treats names such as __proto__ as ordinary aliases.
		const next = Object.fromEntries([...Object.entries(updated), [name, draftValue(editor)]]);
		if (await saveAliases(next)) {
			setEditor(null);
			NotificationsManager.success(editor.originalName === null ? "Alias added" : "Alias updated");
		}
	};

	const updateWindow = (index: number, patch: Partial<ModelGroupAliasWindow>) => {
		setEditor(
			(previous) =>
				previous && {
					...previous,
					schedule: previous.schedule.map((entry, position) => (position === index ? { ...entry, ...patch } : entry)),
				},
		);
	};

	const runHealthCheck = async (name: string) => {
		const resolution = resolveAliasPath(name, aliases, modelNames, new Date());
		const resolvedModel = resolution.resolvedModel;
		if (!resolution.reachable) {
			setHealth((previous) => ({
				...previous,
				[name]: { status: "unhealthy", resolvedModel, error: resolution.error },
			}));
			return;
		}
		setHealth((previous) => ({ ...previous, [name]: { status: "checking", resolvedModel } }));
		try {
			const response = await modelGroupHealthCheckCall(accessToken, name);
			const unhealthy = Number(response?.unhealthy_count ?? 0) > 0;
			const healthy = Number(response?.healthy_count ?? 0) > 0;
			const failure = response?.unhealthy_endpoints?.[0]?.error;
			setHealth((previous) => ({
				...previous,
				[name]: {
					status: healthy && !unhealthy ? "healthy" : "unhealthy",
					resolvedModel,
					error: unhealthy
						? typeof failure === "string"
							? failure
							: "One or more target deployments failed"
						: healthy
							? undefined
							: "Health check returned no deployments",
				},
			}));
		} catch (error) {
			setHealth((previous) => ({
				...previous,
				[name]: { status: "unhealthy", resolvedModel, error: error instanceof Error ? error.message : String(error) },
			}));
		}
	};

	const runAllHealthChecks = async () => {
		setCheckingAll(true);
		try {
			await Promise.all(Object.keys(aliases).map(runHealthCheck));
		} finally {
			setCheckingAll(false);
		}
	};

	return (
		<Card className="mb-6 p-4">
			<div className="mb-4 flex flex-wrap items-start justify-between gap-3">
				<div>
					<h3 className="text-base font-semibold text-gray-900">Model Group Aliases</h3>
					<p className="mt-1 max-w-2xl text-xs text-gray-500">
						Choose a default model and optional daily time windows. Requests outside those windows use the default
						target.
					</p>
				</div>
				<div className="flex gap-2">
					<Button
						size="xs"
						variant="secondary"
						icon={checkingAll ? LoadingOutlined : ReloadOutlined}
						disabled={checkingAll || Object.keys(aliases).length === 0 || saving}
						onClick={runAllHealthChecks}
					>
						Check all
					</Button>
					<Button size="xs" icon={PlusOutlined} disabled={saving} onClick={() => openEditor()}>
						Add Alias
					</Button>
				</div>
			</div>
			<div className="overflow-x-auto rounded-lg border border-gray-200">
				<Table className="[&_td]:py-3 [&_th]:py-2">
					<TableHead>
						<TableRow>
							<TableHeaderCell>Alias</TableHeaderCell>
							<TableHeaderCell>Resolution</TableHeaderCell>
							<TableHeaderCell>Health · current target</TableHeaderCell>
							<TableHeaderCell className="text-right">Actions</TableHeaderCell>
						</TableRow>
					</TableHead>
					<TableBody>
						{Object.entries(aliases).map(([name, value]) => {
							const config = objectAlias(value);
							const resolution = resolutions[name];
							const checked = health[name] ?? emptyHealth();
							const scheduledPath = resolution.path.some((node) => objectAlias(aliases[node])?.schedule?.length);
							const aliasHealth =
								(checked.resolvedModel && checked.resolvedModel !== resolution.resolvedModel) ||
								(scheduledPath && !checked.resolvedModel)
									? emptyHealth()
									: checked;
							return (
								<TableRow key={name} className={resolution.reachable ? "" : "bg-red-50/50"}>
									<TableCell>
										<div className="flex items-center gap-1.5">
											<span className="font-medium text-gray-800">{name}</span>
											<Tooltip title="Copy alias">
												<button
													type="button"
													className="text-gray-400 hover:text-blue-600"
													onClick={() => void navigator.clipboard.writeText(name)}
													aria-label={`Copy alias ${name}`}
												>
													<CopyOutlined />
												</button>
											</Tooltip>
										</div>
									</TableCell>
									<TableCell>
										{config?.schedule?.length ? (
											<div className="mb-2 space-y-1 text-xs text-gray-600">
												<div>
													Default: <span className="font-mono">{config.model}</span>
												</div>
												<div className="font-medium">Daily · {config.timezone}</div>
												{config.schedule.map((entry, index) => (
													<div key={index}>
														<span className="font-mono">
															{entry.start}–{entry.end}
															{entry.end < entry.start ? " (+1 day)" : ""} → {entry.model}
														</span>
													</div>
												))}
											</div>
										) : null}
										<div className="flex flex-wrap items-center gap-1 font-mono text-sm">
											{scheduledPath && <span className="mr-1 font-sans text-xs text-gray-500">Now:</span>}
											{resolution.path.slice(1).map((node, index) => (
												<React.Fragment key={`${node}-${index}`}>
													{index > 0 && <span className="text-gray-400">→</span>}
													<span
														className={
															index < resolution.path.length - 2
																? "rounded border border-amber-200 bg-amber-50 px-1.5 text-amber-700"
																: resolution.reachable
																	? "text-gray-900"
																	: "text-red-600"
														}
													>
														{node}
													</span>
												</React.Fragment>
											))}
										</div>
										{resolution.error && <p className="mt-1 text-xs text-red-600">{resolution.error}</p>}
									</TableCell>
									<TableCell>
										<Tooltip title={aliasHealth.error ?? "Checks the target selected at the time of the request"}>
											<div className="inline-flex items-center gap-1.5">
												<Badge
													size="xs"
													color={
														aliasHealth.status === "healthy"
															? "emerald"
															: aliasHealth.status === "unhealthy"
																? "red"
																: aliasHealth.status === "checking"
																	? "blue"
																	: "gray"
													}
												>
													{aliasHealth.status === "none" ? "not checked" : aliasHealth.status}
												</Badge>
												{aliasHealth.status === "healthy" && <CheckCircleOutlined className="text-emerald-600" />}
												{aliasHealth.status === "unhealthy" && <CloseCircleOutlined className="text-red-600" />}
												<button
													type="button"
													className="text-gray-400 hover:text-blue-600 disabled:opacity-50"
													disabled={aliasHealth.status === "checking" || saving}
													onClick={() => void runHealthCheck(name)}
													aria-label={`Check health for ${name}`}
												>
													{aliasHealth.status === "checking" ? <LoadingOutlined /> : <ReloadOutlined />}
												</button>
											</div>
										</Tooltip>
									</TableCell>
									<TableCell>
										<div className="flex justify-end gap-1">
											<Button
												size="xs"
												variant="light"
												icon={EditOutlined}
												disabled={saving}
												onClick={() => openEditor(name)}
												aria-label={`Edit alias ${name}`}
											/>
											<Button
												size="xs"
												variant="light"
												color="red"
												icon={TrashIcon}
												disabled={saving}
												onClick={() =>
													void saveAliases(Object.fromEntries(Object.entries(aliases).filter(([key]) => key !== name)))
												}
												aria-label={`Delete alias ${name}`}
											/>
										</div>
									</TableCell>
								</TableRow>
							);
						})}
						{Object.keys(aliases).length === 0 && (
							<TableRow>
								<TableCell colSpan={4} className="py-8 text-center text-sm text-gray-400">
									No aliases configured
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>
			<Modal
				title={editor?.originalName === null ? "Add Alias" : "Edit Alias"}
				open={editor !== null}
				onCancel={() => {
					if (!saving) setEditor(null);
				}}
				width={760}
				footer={
					<div className="flex justify-end gap-2">
						<Button size="xs" variant="secondary" disabled={saving} onClick={() => setEditor(null)}>
							Cancel
						</Button>
						<Button size="xs" loading={saving} onClick={() => void saveEditor()}>
							Save
						</Button>
					</div>
				}
			>
				{editor && (
					<div className="space-y-4 py-2">
						<div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
							<div>
								<label htmlFor="alias-name" className="mb-1 block text-sm font-medium">
									Alias name
								</label>
								<Input
									id="alias-name"
									value={editor.name}
									disabled={saving}
									onChange={(event) => setEditor({ ...editor, name: event.target.value })}
								/>
							</div>
							<div>
								<label htmlFor="alias-default" className="mb-1 block text-sm font-medium">
									Default target
								</label>
								<Select
									id="alias-default"
									aria-label="Resolution"
									showSearch
									optionFilterProp="label"
									className="w-full"
									value={editor.model || undefined}
									placeholder="Select a model or alias"
									disabled={saving}
									options={targetOptions.filter((option) => option.value !== editor.name.trim())}
									onChange={(model) => setEditor({ ...editor, model })}
								/>
							</div>
						</div>
						<div className="rounded-lg border border-gray-200 p-3">
							<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
								<span className="text-sm font-medium">Daily time windows</span>
								<Button
									size="xs"
									variant="secondary"
									icon={PlusOutlined}
									disabled={saving}
									onClick={() =>
										setEditor({ ...editor, schedule: [...editor.schedule, { start: "", end: "", model: "" }] })
									}
								>
									Add time window
								</Button>
							</div>
							<p className="mb-3 text-xs text-gray-500">
								Start is included; end is excluded. An earlier end time continues into the next day. Windows cannot
								overlap.
							</p>
							{editor.schedule.length > 0 ? (
								<>
									<label htmlFor="alias-timezone" className="mb-1 block text-sm">
										Time zone
									</label>
									<Input
										id="alias-timezone"
										className="mb-3"
										value={editor.timezone}
										disabled={saving}
										placeholder="Asia/Shanghai"
										onChange={(event) => setEditor({ ...editor, timezone: event.target.value })}
									/>
									{editor.schedule.map((entry, index) => (
										<div
											key={index}
											className="mb-3 grid grid-cols-[1fr_1fr_auto] items-end gap-2 sm:grid-cols-[140px_140px_minmax(160px,1fr)_auto]"
										>
											<div>
												<label htmlFor={`alias-start-${index}`} className="mb-1 block text-xs">
													Start
												</label>
												<Input
													id={`alias-start-${index}`}
													aria-label={`Start time ${index + 1}`}
													type="time"
													step={60}
													disabled={saving}
													value={entry.start}
													onChange={(event) => updateWindow(index, { start: event.target.value })}
												/>
											</div>
											<div>
												<label htmlFor={`alias-end-${index}`} className="mb-1 block text-xs">
													End
												</label>
												<Input
													id={`alias-end-${index}`}
													aria-label={`End time ${index + 1}`}
													type="time"
													step={60}
													disabled={saving}
													value={entry.end}
													onChange={(event) => updateWindow(index, { end: event.target.value })}
												/>
											</div>
											<div className="col-span-2 row-start-2 sm:col-span-1 sm:row-start-auto">
												<label htmlFor={`alias-target-${index}`} className="mb-1 block text-xs">
													Target
												</label>
												<Select
													id={`alias-target-${index}`}
													aria-label={`Time window target ${index + 1}`}
													showSearch
													optionFilterProp="label"
													className="w-full"
													disabled={saving}
													value={entry.model || undefined}
													placeholder="Select a model or alias"
													options={targetOptions.filter((option) => option.value !== editor.name.trim())}
													onChange={(model) => updateWindow(index, { model })}
												/>
											</div>
											<Button
												size="xs"
												variant="light"
												color="red"
												icon={TrashIcon}
												disabled={saving}
												aria-label={`Remove time window ${index + 1}`}
												onClick={() =>
													setEditor({
														...editor,
														schedule: editor.schedule.filter((_, position) => position !== index),
													})
												}
											/>
										</div>
									))}
								</>
							) : (
								<p className="text-xs text-gray-500">The default target is used all day.</p>
							)}
						</div>
						{formError && (
							<p role="alert" className="text-sm text-red-600">
								{formError}
							</p>
						)}
					</div>
				)}
			</Modal>
		</Card>
	);
};

export default ModelGroupAliasSettings;
