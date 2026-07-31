"use client";

import { CodeOutlined, DeleteOutlined, ReloadOutlined, SearchOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Empty, Input, Modal, Select, Space, Tag, Typography } from "antd";
import React, { useMemo, useState } from "react";

export interface CliProxyLogEntry {
	id: number;
	timestamp: string;
	stream: "stdout" | "stderr" | "system" | "oauth";
	message: string;
}

type LogLevel = "info" | "debug" | "warn" | "error";

interface PresentedLog {
	entry: CliProxyLogEntry;
	level: LogLevel;
	message: string;
	method?: string;
	path?: string;
	status?: number;
	latency?: string;
}

interface CliProxyLogViewerProps {
	entries: CliProxyLogEntry[];
	compact?: boolean;
	refreshing?: boolean;
	onRefresh?: () => void;
	onClear?: () => void;
	onViewAll?: () => void;
}

const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;
const HTTP_PATTERN = /\b(GET|POST|PUT|PATCH|DELETE|OPTIONS|HEAD)\s+([^\s|]+)/i;
const STATUS_PATTERN = /(?:^|[\s|])([1-5]\d{2})(?=$|[\s|])/;
const LATENCY_PATTERN = /\b\d+(?:\.\d+)?(?:µs|us|ms|s)\b/i;

function presentLog(entry: CliProxyLogEntry): PresentedLog {
	const message = entry.message.replace(ANSI_PATTERN, "");
	const lowered = message.toLowerCase();
	const level: LogLevel =
		entry.stream === "stderr" || /\b(error|fatal|panic|failed|failure)\b/.test(lowered)
			? "error"
			: /\b(warn|warning|degraded|retry)\b/.test(lowered)
				? "warn"
				: /\b(debug|trace)\b/.test(lowered)
					? "debug"
					: "info";
	const http = message.match(HTTP_PATTERN);
	const statusMatch = message.match(STATUS_PATTERN);
	const status = statusMatch ? Number(statusMatch[1]) : undefined;
	return {
		entry,
		level,
		message,
		method: http?.[1]?.toUpperCase(),
		path: http?.[2],
		status: status && status >= 100 && status <= 599 ? status : undefined,
		latency: message.match(LATENCY_PATTERN)?.[0],
	};
}

function levelColor(level: LogLevel): string {
	if (level === "error") return "red";
	if (level === "warn") return "orange";
	if (level === "debug") return "purple";
	return "blue";
}

function streamColor(stream: CliProxyLogEntry["stream"]): string {
	if (stream === "stderr") return "red";
	if (stream === "system") return "cyan";
	if (stream === "oauth") return "purple";
	return "default";
}

function statusColor(status: number): string {
	if (status >= 500) return "red";
	if (status >= 400) return "orange";
	if (status >= 300) return "blue";
	return "green";
}

function formatRawLogs(entries: CliProxyLogEntry[]): string {
	return entries
		.map(
			(entry) =>
				`${new Date(entry.timestamp).toLocaleString()} [${entry.stream}] ${entry.message.replace(ANSI_PATTERN, "")}`,
		)
		.join("\n");
}

const CliProxyLogViewer: React.FC<CliProxyLogViewerProps> = ({
	entries,
	compact = false,
	refreshing = false,
	onRefresh,
	onClear,
	onViewAll,
}) => {
	const [search, setSearch] = useState("");
	const [streams, setStreams] = useState<CliProxyLogEntry["stream"][]>([]);
	const [levels, setLevels] = useState<LogLevel[]>([]);
	const [rawOpen, setRawOpen] = useState(false);
	const presented = useMemo(() => entries.map(presentLog), [entries]);
	const counts = useMemo(
		() =>
			presented.reduce((result, log) => ({ ...result, [log.level]: result[log.level] + 1 }), {
				info: 0,
				debug: 0,
				warn: 0,
				error: 0,
			} satisfies Record<LogLevel, number>),
		[presented],
	);
	const filtered = useMemo(() => {
		const query = search.trim().toLowerCase();
		return presented.filter((log) => {
			if (streams.length > 0 && !streams.includes(log.entry.stream)) return false;
			if (levels.length > 0 && !levels.includes(log.level)) return false;
			if (!query) return true;
			return (
				log.message.toLowerCase().includes(query) ||
				log.entry.stream.includes(query) ||
				log.method?.toLowerCase().includes(query) ||
				log.path?.toLowerCase().includes(query)
			);
		});
	}, [levels, presented, search, streams]);
	const visible = compact ? filtered.slice(-8) : filtered.slice(-500);

	return (
		<>
			<Card
				data-cliproxy-log-viewer={compact ? "overview" : "full"}
				title={
					<div>
						<div className="flex items-center gap-2">
							<Typography.Text strong>{compact ? "Recent activity" : "Runtime logs"}</Typography.Text>
							<Tag color="green">Live</Tag>
						</div>
						<Typography.Text type="secondary" className="!text-xs">
							{compact
								? "Latest CLIProxy process and management events."
								: "Structured view of CLIProxy stdout, stderr, OAuth and LiteLLM management events."}
						</Typography.Text>
					</div>
				}
				extra={
					<Space wrap>
						<Button size="small" icon={<CodeOutlined />} onClick={() => setRawOpen(true)}>
							Raw log
						</Button>
						{onRefresh && (
							<Button size="small" icon={<ReloadOutlined />} loading={refreshing} onClick={onRefresh}>
								Refresh
							</Button>
						)}
						{compact && onViewAll && (
							<Button size="small" type="link" onClick={onViewAll}>
								View all
							</Button>
						)}
					</Space>
				}
			>
				{!compact && (
					<Space direction="vertical" size="middle" className="mb-4 w-full">
						<div className="grid grid-cols-2 gap-3 md:grid-cols-4">
							{(["info", "debug", "warn", "error"] as const).map((level) => (
								<div key={level} className="rounded-lg border border-slate-200 px-4 py-3">
									<div className="flex items-center justify-between">
										<Tag color={levelColor(level)} className="!mr-0">
											{level.toUpperCase()}
										</Tag>
										<Typography.Text strong className="!text-lg">
											{counts[level]}
										</Typography.Text>
									</div>
								</div>
							))}
						</div>
						<div className="flex flex-wrap gap-2">
							<Input
								allowClear
								value={search}
								onChange={(event) => setSearch(event.target.value)}
								prefix={<SearchOutlined className="text-slate-400" />}
								placeholder="Search message, method or path"
								className="min-w-64 flex-1"
							/>
							<Select
								mode="multiple"
								allowClear
								maxTagCount="responsive"
								value={streams}
								onChange={setStreams}
								placeholder="Filter source"
								className="min-w-52"
								options={(["stdout", "stderr", "system", "oauth"] as const).map((stream) => ({
									value: stream,
									label: stream,
								}))}
							/>
							<Select
								mode="multiple"
								allowClear
								maxTagCount="responsive"
								value={levels}
								onChange={setLevels}
								placeholder="Filter level"
								className="min-w-52"
								options={(["info", "debug", "warn", "error"] as const).map((level) => ({
									value: level,
									label: level.toUpperCase(),
								}))}
							/>
							{onClear && (
								<Button danger icon={<DeleteOutlined />} onClick={onClear}>
									Clear view
								</Button>
							)}
						</div>
						{entries.length > 500 && (
							<Alert type="info" showIcon message={`Showing the newest 500 of ${entries.length} buffered entries.`} />
						)}
					</Space>
				)}

				{visible.length === 0 ? (
					<Empty
						image={Empty.PRESENTED_IMAGE_SIMPLE}
						description={entries.length === 0 ? "No runtime logs yet." : "No logs match the current filters."}
					/>
				) : (
					<div
						className={`${compact ? "max-h-[360px]" : "max-h-[65vh]"} overflow-auto rounded-lg border border-slate-200 bg-white`}
					>
						{visible.map((log) => (
							<div
								key={log.entry.id}
								data-cliproxy-log-row={log.level}
								className={`grid gap-2 border-b border-slate-100 px-3 py-2.5 last:border-b-0 ${
									log.level === "error" ? "bg-red-50/70" : log.level === "warn" ? "bg-amber-50/60" : "hover:bg-slate-50"
								} ${compact ? "grid-cols-[150px_minmax(0,1fr)]" : "grid-cols-[170px_minmax(0,1fr)]"}`}
							>
								<Typography.Text type="secondary" className="font-mono !text-xs">
									{new Date(log.entry.timestamp).toLocaleString()}
								</Typography.Text>
								<div className="min-w-0">
									<div className="mb-1 flex flex-wrap items-center gap-1">
										<Tag color={levelColor(log.level)} className="!mr-0">
											{log.level.toUpperCase()}
										</Tag>
										<Tag color={streamColor(log.entry.stream)} className="!mr-0">
											{log.entry.stream}
										</Tag>
										{log.method && (
											<Tag color="geekblue" className="!mr-0">
												{log.method}
											</Tag>
										)}
										{log.status && (
											<Tag color={statusColor(log.status)} className="!mr-0">
												{log.status}
											</Tag>
										)}
										{log.latency && (
											<span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">{log.latency}</span>
										)}
										{log.path && (
											<Typography.Text code ellipsis={{ tooltip: log.path }} className="!max-w-96">
												{log.path}
											</Typography.Text>
										)}
									</div>
									<Typography.Text className="whitespace-pre-wrap break-words font-mono !text-xs">
										{log.message}
									</Typography.Text>
								</div>
							</div>
						))}
					</div>
				)}

				<div className="mt-3 flex items-center justify-between">
					<Typography.Text type="secondary" className="!text-xs">
						{filtered.length} matching / {entries.length} buffered
					</Typography.Text>
					{compact && entries.length > visible.length && (
						<Typography.Text type="secondary" className="!text-xs">
							Showing newest {visible.length}
						</Typography.Text>
					)}
				</div>
			</Card>

			<Modal title="Raw CLIProxy log" open={rawOpen} onCancel={() => setRawOpen(false)} footer={null} width={960}>
				<pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded bg-slate-950 p-4 text-xs text-slate-100">
					{formatRawLogs(entries) || "No runtime logs yet."}
				</pre>
			</Modal>
		</>
	);
};

export default CliProxyLogViewer;
