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
import { AutoComplete, Input, Tooltip } from "antd";
import React, { useEffect, useMemo, useState } from "react";
import {
	latestHealthChecksCall,
	modelGroupHealthCheckCall,
	routableModelOptionsCall,
	setCallbacksCall,
	type RoutableModelOption,
} from "./networking";
import NotificationsManager from "./molecules/notifications_manager";

type ModelGroupAliasValue = string | { model: string; hidden?: boolean };

interface ModelGroupAliasSettingsProps {
	accessToken: string;
	initialModelGroupAlias?: Record<string, ModelGroupAliasValue>;
	onAliasUpdate?: (updatedAlias: Record<string, string>) => void;
}

interface AliasItem {
	id: string;
	aliasName: string;
	targetModelGroup: string;
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

type AliasHealth = {
	status: "none" | "checking" | "healthy" | "unhealthy";
	error?: string;
};

export function resolveAliasPath(
	aliasName: string,
	aliases: Record<string, string>,
	modelNames: ReadonlySet<string>,
): AliasResolution {
	const path = [aliasName];
	const seen = new Set(path);
	let current = aliasName;
	while (aliases[current]) {
		const target = aliases[current]!;
		path.push(target);
		if (seen.has(target)) {
			return {
				path,
				resolvedModel: target,
				reachable: false,
				error: `Alias cycle: ${path.join(" → ")}`,
			};
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

const emptyHealth = (): AliasHealth => ({ status: "none" });

const ModelGroupAliasSettings: React.FC<ModelGroupAliasSettingsProps> = ({
	accessToken,
	initialModelGroupAlias = {},
	onAliasUpdate,
}) => {
	const [aliases, setAliases] = useState<AliasItem[]>([]);
	const [newAlias, setNewAlias] = useState({ aliasName: "", targetModelGroup: "" });
	const [editingAlias, setEditingAlias] = useState<AliasItem | null>(null);
	const [modelOptions, setModelOptions] = useState<RoutableModelOption[]>([]);
	const [health, setHealth] = useState<Record<string, AliasHealth>>({});
	const [checkingAll, setCheckingAll] = useState(false);

	useEffect(() => {
		setAliases(
			Object.entries(initialModelGroupAlias).map(([aliasName, value]) => ({
				id: aliasName,
				aliasName,
				targetModelGroup: typeof value === "string" ? value : value?.model ?? "",
			})),
		);
	}, [initialModelGroupAlias]);

	useEffect(() => {
		void routableModelOptionsCall()
			.then((response) => setModelOptions(response.data ?? []))
			.catch((error) => NotificationsManager.error(error instanceof Error ? error.message : "Failed to load models"));
		void latestHealthChecksCall(accessToken)
			.then((response) => {
				const checks = response?.latest_health_checks;
				if (!checks || typeof checks !== "object") return;
				setHealth((previous) => {
					const next = { ...previous };
					for (const [key, value] of Object.entries(checks as Record<string, Record<string, unknown>>)) {
						if (!key.startsWith("alias:")) continue;
						const aliasName = key.slice("alias:".length);
						next[aliasName] = {
							status: value.status === "healthy" ? "healthy" : value.status === "unhealthy" ? "unhealthy" : "none",
							error: typeof value.error_message === "string" ? value.error_message : undefined,
						};
					}
					return next;
				});
			})
			.catch(() => undefined);
	}, [accessToken]);

	const aliasObject = useMemo(
		() => Object.fromEntries(aliases.map((alias) => [alias.aliasName, alias.targetModelGroup])),
		[aliases],
	);
	const modelNames = useMemo(
		() => new Set(modelOptions.filter((option) => option.type === "model").map((option) => option.model_name)),
		[modelOptions],
	);
	const resolutions = useMemo(
		() =>
			Object.fromEntries(
				aliases.map((alias) => [alias.aliasName, resolveAliasPath(alias.aliasName, aliasObject, modelNames)]),
			),
		[aliasObject, aliases, modelNames],
	);
	const targetOptions = useMemo(() => {
		const values = new Set<string>(modelOptions.map((option) => option.model_name));
		for (const alias of aliases) values.add(alias.aliasName);
		return [...values].sort().map((value) => ({ value }));
	}, [aliases, modelOptions]);

	const saveAliasesToBackend = async (updatedAliases: AliasItem[]) => {
		const nextAliasObject = Object.fromEntries(
			updatedAliases.map((alias) => [alias.aliasName.trim(), alias.targetModelGroup.trim()]),
		);
		try {
			await setCallbacksCall(accessToken, { router_settings: { model_group_alias: nextAliasObject } });
			onAliasUpdate?.(nextAliasObject);
			setAliases(updatedAliases);
			setHealth((previous) =>
				Object.fromEntries(
					updatedAliases.map((alias) => [alias.aliasName, previous[alias.aliasName] ?? emptyHealth()]),
				),
			);
			return true;
		} catch (error) {
			NotificationsManager.error(error instanceof Error ? error.message : "Failed to save aliases");
			return false;
		}
	};

	const handleAddAlias = async () => {
		const aliasName = newAlias.aliasName.trim();
		const targetModelGroup = newAlias.targetModelGroup.trim();
		if (!aliasName || !targetModelGroup) {
			NotificationsManager.error("Alias name and target model group are required");
			return;
		}
		if (aliases.some((alias) => alias.aliasName === aliasName)) {
			NotificationsManager.error("An alias with this name already exists");
			return;
		}
		if (await saveAliasesToBackend([...aliases, { id: `${Date.now()}-${aliasName}`, aliasName, targetModelGroup }])) {
			setNewAlias({ aliasName: "", targetModelGroup: "" });
			NotificationsManager.success("Alias added");
		}
	};

	const handleUpdateAlias = async () => {
		if (!editingAlias) return;
		const updated = {
			...editingAlias,
			aliasName: editingAlias.aliasName.trim(),
			targetModelGroup: editingAlias.targetModelGroup.trim(),
		};
		if (!updated.aliasName || !updated.targetModelGroup) {
			NotificationsManager.error("Alias name and target model group are required");
			return;
		}
		if (aliases.some((alias) => alias.id !== updated.id && alias.aliasName === updated.aliasName)) {
			NotificationsManager.error("An alias with this name already exists");
			return;
		}
		if (await saveAliasesToBackend(aliases.map((alias) => (alias.id === updated.id ? updated : alias)))) {
			setEditingAlias(null);
			NotificationsManager.success("Alias updated");
		}
	};

	const runHealthCheck = async (aliasName: string) => {
		const resolution = resolutions[aliasName];
		if (!resolution?.reachable) {
			setHealth((previous) => ({
				...previous,
				[aliasName]: { status: "unhealthy", error: resolution?.error ?? "Alias is unreachable" },
			}));
			return;
		}
		setHealth((previous) => ({ ...previous, [aliasName]: { status: "checking" } }));
		try {
			const response = await modelGroupHealthCheckCall(accessToken, aliasName);
			const unhealthy = Number(response?.unhealthy_count ?? 0) > 0;
			const healthy = Number(response?.healthy_count ?? 0) > 0;
			const firstFailure = response?.unhealthy_endpoints?.[0]?.error;
			setHealth((previous) => ({
				...previous,
				[aliasName]: {
					status: healthy && !unhealthy ? "healthy" : "unhealthy",
					error: unhealthy
						? typeof firstFailure === "string"
							? firstFailure
							: "One or more target deployments failed"
						: healthy
							? undefined
							: "Health check returned no deployments",
				},
			}));
		} catch (error) {
			setHealth((previous) => ({
				...previous,
				[aliasName]: { status: "unhealthy", error: error instanceof Error ? error.message : String(error) },
			}));
		}
	};

	const runAllHealthChecks = async () => {
		setCheckingAll(true);
		await Promise.all(aliases.map((alias) => runHealthCheck(alias.aliasName)));
		setCheckingAll(false);
	};

	return (
		<Card className="mb-6 p-4">
			<div className="mb-4 flex flex-wrap items-start justify-between gap-3">
				<div>
					<h3 className="text-base font-semibold text-gray-900">Model Group Aliases</h3>
					<p className="mt-0.5 text-xs text-gray-500">
						Resolution is shown hop by hop. Unreachable aliases are highlighted before traffic reaches them.
					</p>
				</div>
				<Button
					size="xs"
					variant="secondary"
					icon={checkingAll ? LoadingOutlined : ReloadOutlined}
					disabled={checkingAll || aliases.length === 0}
					onClick={runAllHealthChecks}
				>
					Check all
				</Button>
			</div>

			<div className="mb-4 grid grid-cols-1 gap-2 rounded-lg bg-gray-50 p-3 md:grid-cols-[minmax(160px,0.8fr)_minmax(240px,1.4fr)_auto]">
				<Input
					value={newAlias.aliasName}
					onChange={(event) => setNewAlias((previous) => ({ ...previous, aliasName: event.target.value }))}
					placeholder="Alias name"
					size="small"
					onPressEnter={() => void handleAddAlias()}
				/>
				<AutoComplete
					value={newAlias.targetModelGroup}
					options={targetOptions}
					onChange={(value) => setNewAlias((previous) => ({ ...previous, targetModelGroup: value }))}
					placeholder="Select a model or alias"
					filterOption={(input, option) =>
						String(option?.value ?? "")
							.toLowerCase()
							.includes(input.toLowerCase())
					}
					size="small"
				/>
				<Button size="xs" icon={PlusOutlined} onClick={() => void handleAddAlias()}>
					Add Alias
				</Button>
			</div>

			<div className="overflow-hidden rounded-lg border border-gray-200">
				<Table className="[&_td]:py-2 [&_th]:py-2">
					<TableHead>
						<TableRow>
							<TableHeaderCell>Alias</TableHeaderCell>
							<TableHeaderCell>Resolution</TableHeaderCell>
							<TableHeaderCell>Health Status</TableHeaderCell>
							<TableHeaderCell className="text-right">Actions</TableHeaderCell>
						</TableRow>
					</TableHead>
					<TableBody>
						{aliases.map((alias) => {
							const editing = editingAlias?.id === alias.id;
							const resolution = resolutions[alias.aliasName];
							const aliasHealth = health[alias.aliasName] ?? emptyHealth();
							return (
								<TableRow key={alias.id} className={resolution?.reachable ? "" : "bg-red-50/50"}>
									<TableCell>
										{editing ? (
											<Input
												size="small"
												value={editingAlias.aliasName}
												onChange={(event) =>
													setEditingAlias((previous) => previous && { ...previous, aliasName: event.target.value })
												}
											/>
										) : (
											<div className="flex items-center gap-1.5">
												<span className="font-medium text-gray-800">{alias.aliasName}</span>
												<Tooltip title="Copy alias">
													<button
														type="button"
														className="text-gray-400 hover:text-blue-600"
														onClick={() => void navigator.clipboard.writeText(alias.aliasName)}
														aria-label={`Copy alias ${alias.aliasName}`}
													>
														<CopyOutlined />
													</button>
												</Tooltip>
											</div>
										)}
									</TableCell>
									<TableCell>
										{editing ? (
											<AutoComplete
												size="small"
												value={editingAlias.targetModelGroup}
												options={targetOptions.filter((option) => option.value !== editingAlias.aliasName)}
												onChange={(value) =>
													setEditingAlias((previous) => previous && { ...previous, targetModelGroup: value })
												}
												filterOption={(input, option) =>
													String(option?.value ?? "")
														.toLowerCase()
														.includes(input.toLowerCase())
												}
											/>
										) : (
											<div>
												<div className="flex flex-wrap items-center gap-1 font-mono text-sm">
													{resolution?.path.slice(1).map((node, index) => {
														const isTerminal = index === resolution.path.length - 2;
														return (
															<React.Fragment key={`${node}-${index}`}>
																{index > 0 && <span className="text-gray-400">→</span>}
																{isTerminal ? (
																	<span className={resolution.reachable ? "text-gray-900" : "text-red-600"}>
																		{node}
																	</span>
																) : (
																	<span className="rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-amber-700">
																		{node}
																	</span>
																)}
															</React.Fragment>
														);
													})}
												</div>
												{resolution?.error && <p className="mt-1 text-xs text-red-600">{resolution.error}</p>}
											</div>
										)}
									</TableCell>
									<TableCell>
										<Tooltip title={aliasHealth.error}>
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
													{aliasHealth.status === "checking"
														? "checking"
														: aliasHealth.status === "none"
															? "not checked"
															: aliasHealth.status}
												</Badge>
												{aliasHealth.status === "healthy" && <CheckCircleOutlined className="text-emerald-600" />}
												{aliasHealth.status === "unhealthy" && <CloseCircleOutlined className="text-red-600" />}
												<button
													type="button"
													className="text-gray-400 hover:text-blue-600 disabled:opacity-50"
													disabled={aliasHealth.status === "checking"}
													onClick={() => void runHealthCheck(alias.aliasName)}
													aria-label={`Check health for ${alias.aliasName}`}
												>
													{aliasHealth.status === "checking" ? <LoadingOutlined /> : <ReloadOutlined />}
												</button>
											</div>
										</Tooltip>
									</TableCell>
									<TableCell>
										<div className="flex justify-end gap-1">
											{editing ? (
												<>
													<Button size="xs" onClick={() => void handleUpdateAlias()}>
														Save
													</Button>
													<Button size="xs" variant="secondary" onClick={() => setEditingAlias(null)}>
														Cancel
													</Button>
												</>
											) : (
												<>
													<Button
														size="xs"
														variant="light"
														icon={EditOutlined}
														onClick={() => setEditingAlias({ ...alias })}
														aria-label={`Edit alias ${alias.aliasName}`}
													/>
													<Button
														size="xs"
														variant="light"
														color="red"
														icon={TrashIcon}
														onClick={() => void saveAliasesToBackend(aliases.filter((item) => item.id !== alias.id))}
														aria-label={`Delete alias ${alias.aliasName}`}
													/>
												</>
											)}
										</div>
									</TableCell>
								</TableRow>
							);
						})}
						{aliases.length === 0 && (
							<TableRow>
								<TableCell colSpan={4} className="py-8 text-center text-sm text-gray-400">
									No aliases configured
								</TableCell>
							</TableRow>
						)}
					</TableBody>
				</Table>
			</div>
		</Card>
	);
};

export default ModelGroupAliasSettings;
