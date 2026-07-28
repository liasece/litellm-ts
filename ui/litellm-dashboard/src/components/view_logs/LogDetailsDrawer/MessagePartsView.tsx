import { Typography } from "antd";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MessagePart } from "./prettyMessagesTypes";
import { SimpleToolCallBlock } from "./SimpleToolCallBlock";

const { Text } = Typography;

const PART_TONES: Record<string, { background: string; border: string; color: string }> = {
	thinking: { background: "#faf5ff", border: "#e9d5ff", color: "#7e22ce" },
	redacted_thinking: { background: "#fafafa", border: "#e5e7eb", color: "#6b7280" },
	tool_result: { background: "#fff7ed", border: "#fed7aa", color: "#c2410c" },
	web_search: { background: "#eff6ff", border: "#bfdbfe", color: "#1d4ed8" },
	file_search: { background: "#eff6ff", border: "#bfdbfe", color: "#1d4ed8" },
	computer: { background: "#f0fdfa", border: "#99f6e4", color: "#0f766e" },
	code: { background: "#f8fafc", border: "#cbd5e1", color: "#334155" },
	code_result: { background: "#f8fafc", border: "#cbd5e1", color: "#334155" },
	image: { background: "#f8fafc", border: "#e2e8f0", color: "#475569" },
	document: { background: "#f8fafc", border: "#e2e8f0", color: "#475569" },
	audio: { background: "#f8fafc", border: "#e2e8f0", color: "#475569" },
	refusal: { background: "#fef2f2", border: "#fecaca", color: "#b91c1c" },
	unknown: { background: "#fffbeb", border: "#fde68a", color: "#92400e" },
};

function safeJson(value: any): string {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return "[Unserializable content]";
	}
}

function MarkdownText({ children }: { children: string }) {
	return (
		<ReactMarkdown
			remarkPlugins={[remarkGfm]}
			components={{
				p: ({ children: paragraph }) => <p style={{ margin: "0 0 6px" }}>{paragraph}</p>,
				pre: ({ children: code }) => (
					<pre style={{ overflow: "auto", padding: 8, borderRadius: 4, background: "#f6f8fa" }}>{code}</pre>
				),
				code: ({ children: code }) => (
					<code style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 12 }}>{code}</code>
				),
			}}
		>
			{children}
		</ReactMarkdown>
	);
}

function OperationPart({ part, compact }: { part: MessagePart; compact: boolean }) {
	if (part.kind === "tool_call") {
		return (
			<SimpleToolCallBlock
				tool={{
					id: part.id || "",
					name: part.name || "unknown",
					arguments: part.data && typeof part.data === "object" ? part.data : { raw: part.data },
				}}
				compact={compact}
				badge={part.label}
			/>
		);
	}

	const tone = PART_TONES[part.kind] || PART_TONES.unknown;
	const detail = part.text || (part.data !== undefined ? safeJson(part.data) : "");

	return (
		<div
			data-message-part={part.kind}
			style={{
				background: tone.background,
				border: `1px solid ${tone.border}`,
				borderRadius: 6,
				padding: compact ? "7px 10px" : "10px 12px",
				marginTop: 8,
			}}
		>
			<div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: detail ? 6 : 0 }}>
				<Text
					strong
					style={{
						color: tone.color,
						fontSize: 10,
						letterSpacing: "0.4px",
						textTransform: "uppercase",
					}}
				>
					{part.label}
				</Text>
				{part.name ? <Text style={{ fontSize: 12 }}>{part.name}</Text> : null}
				{part.status ? (
					<Text type={part.isError ? "danger" : "secondary"} style={{ fontSize: 11 }}>
						{part.status}
					</Text>
				) : null}
				{part.id ? (
					<Text type="secondary" ellipsis style={{ fontSize: 10, marginLeft: "auto", maxWidth: 220 }}>
						{part.id}
					</Text>
				) : null}
			</div>
			{detail && (part.kind === "thinking" || part.kind === "refusal") ? (
				<div style={{ fontSize: 12, lineHeight: 1.6, color: "#262626" }}>
					<MarkdownText>{detail}</MarkdownText>
				</div>
			) : detail ? (
				<pre
					style={{
						margin: 0,
						maxHeight: compact ? 180 : 320,
						overflow: "auto",
						fontFamily: part.kind === "thinking" ? "inherit" : "ui-monospace, SFMono-Regular, Menlo, monospace",
						fontSize: 12,
						lineHeight: 1.6,
						whiteSpace: "pre-wrap",
						wordBreak: "break-word",
						color: "#262626",
					}}
				>
					{detail}
				</pre>
			) : null}
		</div>
	);
}

export function MessagePartsView({ parts, compact = false }: { parts: MessagePart[]; compact?: boolean }) {
	const pairedResultIndexes = new Set<number>();
	const toolResultsByCallIndex = new Map<number, MessagePart>();

	parts.forEach((part, callIndex) => {
		if (part.kind !== "tool_call" || !part.id) return;
		const resultIndex = parts.findIndex(
			(candidate, index) =>
				!pairedResultIndexes.has(index) && candidate.kind === "tool_result" && candidate.id === part.id,
		);
		if (resultIndex < 0) return;
		pairedResultIndexes.add(resultIndex);
		toolResultsByCallIndex.set(callIndex, parts[resultIndex]);
	});

	return (
		<div>
			{parts.map((part, index) => {
				if (pairedResultIndexes.has(index)) return null;
				if (part.kind === "text") {
					return (
						<div
							key={`${part.kind}-${index}`}
							data-message-part="text"
							style={{
								fontSize: 13,
								lineHeight: 1.7,
								color: "#262626",
								whiteSpace: "pre-wrap",
								wordBreak: "break-word",
								marginTop: index === 0 ? 0 : 8,
							}}
						>
							<MarkdownText>{part.text || ""}</MarkdownText>
						</div>
					);
				}
				if (part.kind === "tool_call") {
					return (
						<SimpleToolCallBlock
							key={`${part.kind}-${part.id || index}`}
							tool={{
								id: part.id || "",
								name: part.name || "unknown",
								arguments: part.data && typeof part.data === "object" ? part.data : { raw: part.data },
							}}
							compact={compact}
							badge={part.label}
							result={toolResultsByCallIndex.get(index)}
						/>
					);
				}
				return <OperationPart key={`${part.kind}-${part.id || index}`} part={part} compact={compact} />;
			})}
		</div>
	);
}
