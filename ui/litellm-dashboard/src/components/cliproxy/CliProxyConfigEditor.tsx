"use client";

import {
	ApiOutlined,
	CodeOutlined,
	DashboardOutlined,
	FileTextOutlined,
	RetweetOutlined,
	SafetyCertificateOutlined,
	SaveOutlined,
} from "@ant-design/icons";
import { Alert, Button, Card, Col, Form, Input, InputNumber, Row, Select, Space, Switch, Tag, Typography } from "antd";
import React, { useMemo, useState } from "react";

type UserConfig = Record<string, unknown>;
type DisableImageGeneration = "false" | "true" | "chat" | "passthrough";

interface VisualConfigValues {
	debug: boolean;
	commercialMode: boolean;
	requestLog: boolean;
	usageStatisticsEnabled: boolean;
	proxyUrl: string;
	requestRetry: number;
	maxRetryCredentials: number;
	maxRetryInterval: number;
	authAutoRefreshWorkers: number | null;
	disableCooling: boolean;
	saveCooldownStatus: boolean;
	transientErrorCooldownSeconds: number;
	forceModelPrefix: boolean;
	passthroughHeaders: boolean;
	wsAuth: boolean;
	routingStrategy: "round-robin" | "weighted-round-robin" | "fill-first";
	routingSessionAffinity: boolean;
	routingSessionAffinityTtl: string;
	quotaSwitchProject: boolean;
	quotaSwitchPreviewModel: boolean;
	quotaAntigravityCredits: boolean;
	disableImageGeneration: DisableImageGeneration;
	gptImage2BaseModel: string;
	logsMaxTotalSizeMb: number;
	errorLogsMaxFiles: number;
	redisUsageQueueRetentionSeconds: number;
}

interface CliProxyConfigEditorProps {
	enabled: boolean;
	userConfig: UserConfig;
	saving: boolean;
	onSave: (enabled: boolean, config: UserConfig) => Promise<void>;
	onOpenRaw: () => void;
}

function asRecord(value: unknown): UserConfig {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as UserConfig) : {};
}

function booleanValue(record: UserConfig, key: string, fallback: boolean): boolean {
	return typeof record[key] === "boolean" ? record[key] : fallback;
}

function numberValue(record: UserConfig, key: string, fallback: number): number {
	return typeof record[key] === "number" && Number.isFinite(record[key]) ? record[key] : fallback;
}

function optionalNumberValue(record: UserConfig, key: string): number | null {
	return typeof record[key] === "number" && Number.isFinite(record[key]) ? record[key] : null;
}

function stringValue(record: UserConfig, key: string, fallback: string): string {
	return typeof record[key] === "string" ? record[key] : fallback;
}

function readDisableImageGeneration(value: unknown): DisableImageGeneration {
	if (value === true) return "true";
	if (value === "chat" || value === "passthrough") return value;
	return "false";
}

function visualValuesFromConfig(config: UserConfig): VisualConfigValues {
	const routing = asRecord(config.routing);
	const quotaExceeded = asRecord(config["quota-exceeded"]);
	return {
		debug: booleanValue(config, "debug", false),
		commercialMode: booleanValue(config, "commercial-mode", false),
		requestLog: booleanValue(config, "request-log", false),
		usageStatisticsEnabled: booleanValue(config, "usage-statistics-enabled", false),
		proxyUrl: stringValue(config, "proxy-url", ""),
		requestRetry: numberValue(config, "request-retry", 3),
		maxRetryCredentials: numberValue(config, "max-retry-credentials", 0),
		maxRetryInterval: numberValue(config, "max-retry-interval", 30),
		authAutoRefreshWorkers: optionalNumberValue(config, "auth-auto-refresh-workers"),
		disableCooling: booleanValue(config, "disable-cooling", false),
		saveCooldownStatus: booleanValue(config, "save-cooldown-status", false),
		transientErrorCooldownSeconds: numberValue(config, "transient-error-cooldown-seconds", 0),
		forceModelPrefix: booleanValue(config, "force-model-prefix", false),
		passthroughHeaders: booleanValue(config, "passthrough-headers", false),
		wsAuth: booleanValue(config, "ws-auth", true),
		routingStrategy:
			routing.strategy === "weighted-round-robin" || routing.strategy === "fill-first"
				? routing.strategy
				: "round-robin",
		routingSessionAffinity: booleanValue(routing, "session-affinity", false),
		routingSessionAffinityTtl: stringValue(routing, "session-affinity-ttl", "1h"),
		quotaSwitchProject: booleanValue(quotaExceeded, "switch-project", true),
		quotaSwitchPreviewModel: booleanValue(quotaExceeded, "switch-preview-model", true),
		quotaAntigravityCredits: booleanValue(quotaExceeded, "antigravity-credits", true),
		disableImageGeneration: readDisableImageGeneration(config["disable-image-generation"]),
		gptImage2BaseModel: stringValue(config, "gpt-image-2-base-model", ""),
		logsMaxTotalSizeMb: numberValue(config, "logs-max-total-size-mb", 0),
		errorLogsMaxFiles: numberValue(config, "error-logs-max-files", 10),
		redisUsageQueueRetentionSeconds: numberValue(config, "redis-usage-queue-retention-seconds", 60),
	};
}

function applyVisualValues(config: UserConfig, values: VisualConfigValues): UserConfig {
	const next = JSON.parse(JSON.stringify(config)) as UserConfig;
	next.debug = values.debug;
	next["commercial-mode"] = values.commercialMode;
	next["request-log"] = values.requestLog;
	next["usage-statistics-enabled"] = values.usageStatisticsEnabled;
	next["proxy-url"] = values.proxyUrl;
	next["request-retry"] = values.requestRetry;
	next["max-retry-credentials"] = values.maxRetryCredentials;
	next["max-retry-interval"] = values.maxRetryInterval;
	if (values.authAutoRefreshWorkers === null) {
		delete next["auth-auto-refresh-workers"];
	} else {
		next["auth-auto-refresh-workers"] = values.authAutoRefreshWorkers;
	}
	next["disable-cooling"] = values.disableCooling;
	next["save-cooldown-status"] = values.saveCooldownStatus;
	next["transient-error-cooldown-seconds"] = values.transientErrorCooldownSeconds;
	next["force-model-prefix"] = values.forceModelPrefix;
	next["passthrough-headers"] = values.passthroughHeaders;
	next["ws-auth"] = values.wsAuth;
	next.routing = {
		...asRecord(next.routing),
		strategy: values.routingStrategy,
		"session-affinity": values.routingSessionAffinity,
		"session-affinity-ttl": values.routingSessionAffinityTtl,
	};
	next["quota-exceeded"] = {
		...asRecord(next["quota-exceeded"]),
		"switch-project": values.quotaSwitchProject,
		"switch-preview-model": values.quotaSwitchPreviewModel,
		"antigravity-credits": values.quotaAntigravityCredits,
	};
	next["disable-image-generation"] =
		values.disableImageGeneration === "true"
			? true
			: values.disableImageGeneration === "false"
				? false
				: values.disableImageGeneration;
	if (values.gptImage2BaseModel.trim()) {
		next["gpt-image-2-base-model"] = values.gptImage2BaseModel.trim();
	} else {
		delete next["gpt-image-2-base-model"];
	}
	next["logs-max-total-size-mb"] = values.logsMaxTotalSizeMb;
	next["error-logs-max-files"] = values.errorLogsMaxFiles;
	next["redis-usage-queue-retention-seconds"] = values.redisUsageQueueRetentionSeconds;
	return next;
}

const SettingToggle: React.FC<{
	title: string;
	description: string;
	checked: boolean;
	onChange: (value: boolean) => void;
	danger?: boolean;
}> = ({ title, description, checked, onChange, danger }) => (
	<div
		className={`flex min-h-24 items-start justify-between gap-5 rounded-lg border p-4 ${danger ? "border-amber-200 bg-amber-50" : "border-slate-200"}`}
	>
		<div>
			<div className="mb-1 flex items-center gap-2">
				<Typography.Text strong>{title}</Typography.Text>
				{danger && <Tag color="warning">Troubleshooting only</Tag>}
			</div>
			<Typography.Paragraph type="secondary" className="!mb-0 !text-sm">
				{description}
			</Typography.Paragraph>
		</div>
		<Switch checked={checked} onChange={onChange} />
	</div>
);

const SectionTitle: React.FC<{ icon: React.ReactNode; title: string; description: string }> = ({
	icon,
	title,
	description,
}) => (
	<div>
		<div className="flex items-center gap-2">
			<span className="text-blue-600">{icon}</span>
			<Typography.Text strong>{title}</Typography.Text>
		</div>
		<Typography.Text type="secondary" className="!text-xs">
			{description}
		</Typography.Text>
	</div>
);

const CliProxyConfigEditor: React.FC<CliProxyConfigEditorProps> = ({
	enabled,
	userConfig,
	saving,
	onSave,
	onOpenRaw,
}) => {
	const sourceValues = useMemo(() => visualValuesFromConfig(userConfig), [userConfig]);
	const [draftEnabled, setDraftEnabled] = useState(enabled);
	const [values, setValues] = useState<VisualConfigValues>(sourceValues);

	const dirty = draftEnabled !== enabled || JSON.stringify(values) !== JSON.stringify(sourceValues);
	const setValue = <K extends keyof VisualConfigValues>(key: K, value: VisualConfigValues[K]) => {
		setValues((current) => ({ ...current, [key]: value }));
	};

	return (
		<Space direction="vertical" size="middle" className="w-full">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div>
					<Typography.Title level={4} className="!mb-1">
						CLIProxy configuration
					</Typography.Title>
					<Typography.Text type="secondary">
						Common settings are grouped by purpose. Unknown advanced fields are preserved when these settings are
						applied.
					</Typography.Text>
				</div>
				<Space>
					<Button icon={<CodeOutlined />} onClick={onOpenRaw}>
						Edit raw config
					</Button>
					<Button
						onClick={() => {
							setDraftEnabled(enabled);
							setValues(sourceValues);
						}}
						disabled={!dirty || saving}
					>
						Reset
					</Button>
					<Button
						type="primary"
						icon={<SaveOutlined />}
						loading={saving}
						disabled={!dirty}
						onClick={() => void onSave(draftEnabled, applyVisualValues(userConfig, values))}
					>
						Save and apply
					</Button>
				</Space>
			</div>

			<Alert
				type="info"
				showIcon
				message="LiteLLM owns the private service boundary"
				description={
					<span>
						Host, port, TLS, credential directory, proxy API key, file logging and remote-management isolation are
						generated by LiteLLM and cannot be changed here. See the{" "}
						<Typography.Link href="https://help.router-for.me/cn/configuration/options" target="_blank">
							official CLIProxyAPI configuration reference
						</Typography.Link>
						.
					</span>
				}
			/>

			<Card
				data-cliproxy-config-section="managed"
				title={
					<SectionTitle
						icon={<SafetyCertificateOutlined />}
						title="Managed service boundary"
						description="Read-only security settings enforced whenever LiteLLM projects config.yaml."
					/>
				}
			>
				<Row gutter={[12, 12]}>
					{[
						["Listener", "127.0.0.1:8317"],
						["TLS", "Disabled on internal hop"],
						["Credentials", "Managed runtime directory"],
						["Remote management", "Loopback only"],
						["File logging", "Captured through process output"],
					].map(([label, value]) => (
						<Col xs={24} md={12} xl={8} key={label}>
							<div className="rounded-lg bg-slate-50 p-3">
								<Typography.Text type="secondary" className="block !text-xs">
									{label}
								</Typography.Text>
								<Typography.Text strong>{value}</Typography.Text>
							</div>
						</Col>
					))}
				</Row>
			</Card>

			<Card
				data-cliproxy-config-section="runtime"
				title={
					<SectionTitle
						icon={<DashboardOutlined />}
						title="Runtime and diagnostics"
						description="Control the managed process and the amount of diagnostic work performed per request."
					/>
				}
			>
				<Row gutter={[16, 16]}>
					<Col xs={24} md={12}>
						<SettingToggle
							title="Enable managed runtime"
							description="Starts CLIProxy with LiteLLM and keeps the private upstream available. Disabling it stops all models using this provider."
							checked={draftEnabled}
							onChange={setDraftEnabled}
						/>
					</Col>
					<Col xs={24} md={12}>
						<SettingToggle
							title="Debug logging"
							description="Adds detailed diagnostic messages. Keep it disabled during normal operation to reduce noise."
							checked={values.debug}
							onChange={(value) => setValue("debug", value)}
						/>
					</Col>
					<Col xs={24} md={12}>
						<SettingToggle
							title="Commercial mode"
							description="Disables high-overhead request logging and middleware to reduce memory use under high concurrency. A process restart may be required."
							checked={values.commercialMode}
							onChange={(value) => setValue("commercialMode", value)}
						/>
					</Col>
					<Col xs={24} md={12}>
						<SettingToggle
							title="Usage statistics"
							description="Aggregates request usage in memory for CLIProxy management and usage reporting."
							checked={values.usageStatisticsEnabled}
							onChange={(value) => setValue("usageStatisticsEnabled", value)}
						/>
					</Col>
					<Col span={24}>
						<SettingToggle
							title="Detailed request log"
							description="Records detailed request and response diagnostics. It may contain sensitive payload context and has significant I/O cost; enable only while investigating a problem."
							checked={values.requestLog}
							onChange={(value) => setValue("requestLog", value)}
							danger
						/>
					</Col>
				</Row>
			</Card>

			<Card
				data-cliproxy-config-section="routing"
				title={
					<SectionTitle
						icon={<RetweetOutlined />}
						title="Routing and reliability"
						description="Choose credentials, retry recoverable failures and control session stickiness."
					/>
				}
			>
				<Form layout="vertical">
					<Row gutter={16}>
						<Col xs={24} lg={12}>
							<Form.Item
								label="Global outbound proxy"
								extra='Supports socks5, http and https URLs. Individual credentials may use "direct" or "none" to bypass it.'
							>
								<Input
									value={values.proxyUrl}
									onChange={(event) => setValue("proxyUrl", event.target.value)}
									placeholder="socks5://user:pass@127.0.0.1:1080/"
								/>
							</Form.Item>
						</Col>
						<Col xs={24} lg={12}>
							<Form.Item
								label="Credential routing strategy"
								extra="Round robin balances requests; weighted round robin uses account weights; fill first exhausts the preferred credential before moving on."
							>
								<Select
									value={values.routingStrategy}
									onChange={(value) => setValue("routingStrategy", value)}
									options={[
										{ value: "round-robin", label: "Round robin" },
										{ value: "weighted-round-robin", label: "Weighted round robin" },
										{ value: "fill-first", label: "Fill first" },
									]}
								/>
							</Form.Item>
						</Col>
						<Col xs={12} lg={6}>
							<Form.Item label="Request retries" extra="Retries 403, 408, 500, 502, 503 and 504 responses.">
								<InputNumber
									min={0}
									className="w-full"
									value={values.requestRetry}
									onChange={(value) => setValue("requestRetry", value ?? 0)}
								/>
							</Form.Item>
						</Col>
						<Col xs={12} lg={6}>
							<Form.Item
								label="Maximum credentials"
								extra="0 keeps legacy behavior and may try every matching credential."
							>
								<InputNumber
									min={0}
									className="w-full"
									value={values.maxRetryCredentials}
									onChange={(value) => setValue("maxRetryCredentials", value ?? 0)}
								/>
							</Form.Item>
						</Col>
						<Col xs={12} lg={6}>
							<Form.Item
								label="Maximum retry wait"
								extra="Seconds to wait for a cooled credential before another attempt."
							>
								<InputNumber
									min={0}
									className="w-full"
									value={values.maxRetryInterval}
									onChange={(value) => setValue("maxRetryInterval", value ?? 0)}
								/>
							</Form.Item>
						</Col>
						<Col xs={12} lg={6}>
							<Form.Item
								label="Token refresh workers"
								extra="Leave empty for CLIProxy's default worker pool (currently 16)."
							>
								<InputNumber
									min={1}
									className="w-full"
									value={values.authAutoRefreshWorkers ?? undefined}
									onChange={(value) => setValue("authAutoRefreshWorkers", value)}
									placeholder="Default"
								/>
							</Form.Item>
						</Col>
						<Col xs={24} lg={12}>
							<Form.Item
								label="Session affinity TTL"
								extra="How long a session stays bound to one credential. Automatic failover remains available."
							>
								<Input
									value={values.routingSessionAffinityTtl}
									onChange={(event) => setValue("routingSessionAffinityTtl", event.target.value)}
									placeholder="1h"
								/>
							</Form.Item>
						</Col>
						<Col xs={24} lg={12}>
							<Form.Item
								label="Transient error cooldown"
								extra="Seconds for 408/500/502/503/504 failures. 0 uses the legacy 60 seconds; -1 disables this cooldown."
							>
								<InputNumber
									min={-1}
									className="w-full"
									value={values.transientErrorCooldownSeconds}
									onChange={(value) => setValue("transientErrorCooldownSeconds", value ?? 0)}
								/>
							</Form.Item>
						</Col>
					</Row>
				</Form>
				<Row gutter={[16, 16]}>
					{[
						{
							key: "routingSessionAffinity" as const,
							title: "Session affinity",
							description:
								"Keeps a conversation on the same credential to improve cache continuity while retaining failover.",
						},
						{
							key: "disableCooling" as const,
							title: "Disable cooldown scheduling",
							description:
								"Prevents temporary blackout windows after failures. This can cause repeated traffic to an unhealthy credential.",
						},
						{
							key: "saveCooldownStatus" as const,
							title: "Persist cooldown status",
							description: "Writes per-credential cooldown state beside auth files so it survives a process restart.",
						},
						{
							key: "forceModelPrefix" as const,
							title: "Force model prefix",
							description: "Unprefixed model requests only use credentials without a configured prefix.",
						},
						{
							key: "passthroughHeaders" as const,
							title: "Pass through response headers",
							description: "Forwards filtered upstream response headers to the LiteLLM client.",
						},
						{
							key: "wsAuth" as const,
							title: "WebSocket authentication",
							description: "Requires authentication for CLIProxy WebSocket endpoints such as /v1/ws.",
						},
					].map((setting) => (
						<Col xs={24} md={12} key={setting.key}>
							<SettingToggle
								title={setting.title}
								description={setting.description}
								checked={values[setting.key]}
								onChange={(value) => setValue(setting.key, value)}
							/>
						</Col>
					))}
				</Row>
			</Card>

			<Card
				data-cliproxy-config-section="quota"
				title={
					<SectionTitle
						icon={<ApiOutlined />}
						title="Quota fallback and image generation"
						description="Define how CLIProxy recovers from exhausted subscriptions and handles hosted image tools."
					/>
				}
			>
				<Row gutter={[16, 16]}>
					<Col xs={24} md={8}>
						<SettingToggle
							title="Switch project"
							description="Try another eligible project when the selected project has exhausted its quota."
							checked={values.quotaSwitchProject}
							onChange={(value) => setValue("quotaSwitchProject", value)}
						/>
					</Col>
					<Col xs={24} md={8}>
						<SettingToggle
							title="Switch preview model"
							description="Fall back between preview model variants when one variant has exhausted its quota."
							checked={values.quotaSwitchPreviewModel}
							onChange={(value) => setValue("quotaSwitchPreviewModel", value)}
						/>
					</Col>
					<Col xs={24} md={8}>
						<SettingToggle
							title="Use Antigravity credits"
							description="Use paid Google One AI credits as the last fallback after free-tier credentials are exhausted."
							checked={values.quotaAntigravityCredits}
							onChange={(value) => setValue("quotaAntigravityCredits", value)}
						/>
					</Col>
				</Row>
				<Form layout="vertical" className="!mt-4">
					<Row gutter={16}>
						<Col xs={24} lg={12}>
							<Form.Item
								label="Image generation behavior"
								extra="Disable everywhere, only disable chat-tool injection, or pass non-image payloads through unchanged."
							>
								<Select
									value={values.disableImageGeneration}
									onChange={(value) => setValue("disableImageGeneration", value)}
									options={[
										{ value: "false", label: "Enabled everywhere" },
										{ value: "true", label: "Disabled everywhere" },
										{ value: "chat", label: "Disable chat injection only" },
										{ value: "passthrough", label: "Passthrough non-image endpoints" },
									]}
								/>
							</Form.Item>
						</Col>
						<Col xs={24} lg={12}>
							<Form.Item
								label="GPT Image 2 base model"
								extra="Used by the legacy hosted image_generation path. Empty or invalid values fall back to gpt-5.4-mini."
							>
								<Input
									value={values.gptImage2BaseModel}
									onChange={(event) => setValue("gptImage2BaseModel", event.target.value)}
									placeholder="gpt-5.4-mini"
								/>
							</Form.Item>
						</Col>
					</Row>
				</Form>
			</Card>

			<Card
				data-cliproxy-config-section="logging"
				title={
					<SectionTitle
						icon={<FileTextOutlined />}
						title="Log and usage retention"
						description="Bound diagnostic storage and the in-memory management usage queue."
					/>
				}
			>
				<Form layout="vertical">
					<Row gutter={16}>
						<Col xs={24} md={8}>
							<Form.Item label="Maximum log size (MB)" extra="0 means no total-size cleanup limit.">
								<InputNumber
									min={0}
									className="w-full"
									value={values.logsMaxTotalSizeMb}
									onChange={(value) => setValue("logsMaxTotalSizeMb", value ?? 0)}
								/>
							</Form.Item>
						</Col>
						<Col xs={24} md={8}>
							<Form.Item label="Error log files" extra="Maximum retained error files; 0 disables cleanup.">
								<InputNumber
									min={0}
									className="w-full"
									value={values.errorLogsMaxFiles}
									onChange={(value) => setValue("errorLogsMaxFiles", value ?? 0)}
								/>
							</Form.Item>
						</Col>
						<Col xs={24} md={8}>
							<Form.Item
								label="Usage queue retention"
								extra="Seconds to retain management usage items in memory (1–3600)."
							>
								<InputNumber
									min={1}
									max={3600}
									className="w-full"
									value={values.redisUsageQueueRetentionSeconds}
									onChange={(value) => setValue("redisUsageQueueRetentionSeconds", value ?? 60)}
								/>
							</Form.Item>
						</Col>
					</Row>
				</Form>
			</Card>
		</Space>
	);
};

export default CliProxyConfigEditor;
