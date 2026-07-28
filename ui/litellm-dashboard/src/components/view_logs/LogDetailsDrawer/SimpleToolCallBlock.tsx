/**
 * SimpleToolCallBlock - Simple tool call display without copy button
 * Used in compact/tree views
 */

import { Typography } from "antd";
import { MessagePart, ToolCall } from "./prettyMessagesTypes";

const { Text } = Typography;

interface SimpleToolCallBlockProps {
	tool: ToolCall;
	compact?: boolean;
	badge?: string;
	result?: MessagePart;
}

function formatToolResult(result: MessagePart): string {
	if (result.text) return result.text;
	if (result.data !== undefined) {
		try {
			return JSON.stringify(result.data, null, 2);
		} catch {
			return "[Unserializable tool output]";
		}
	}
	return "（空输出）";
}

export function SimpleToolCallBlock({
	tool,
	compact = false,
	badge = "Function call",
	result,
}: SimpleToolCallBlockProps) {
	return (
		<div
			style={{
				background: "#f8f9fa",
				border: "1px solid #e9ecef",
				borderRadius: 6,
				padding: compact ? "6px 10px" : "10px 14px",
				marginTop: 8,
				fontFamily: "monospace",
				fontSize: 12,
				position: "relative",
			}}
		>
			{/* Function badge */}
			<div
				style={{
					position: "absolute",
					top: -8,
					left: 12,
					background: "#fff",
					padding: "0 6px",
					fontSize: 10,
					color: "#8c8c8c",
					border: "1px solid #e9ecef",
					borderRadius: 3,
				}}
			>
				{badge}
			</div>

			<Text strong style={{ fontSize: 13, display: "block", marginBottom: 6 }}>
				{tool.name}
			</Text>

			{Object.keys(tool.arguments).length > 0 && (
				<div>
					{Object.entries(tool.arguments).map(([key, value]) => (
						<div key={key} style={{ marginBottom: 2 }}>
							<Text type="secondary" style={{ fontSize: 12 }}>
								{key}:{" "}
							</Text>
							<Text style={{ fontSize: 12 }}>{JSON.stringify(value)}</Text>
						</div>
					))}
				</div>
			)}

			{result ? (
				<div
					data-tool-output-for={tool.id}
					style={{
						marginTop: 10,
						paddingTop: 9,
						borderTop: `1px solid ${result.isError ? "#fecaca" : "#d1d5db"}`,
					}}
				>
					<div
						style={{
							display: "flex",
							alignItems: "center",
							gap: 8,
							marginBottom: 5,
							color: result.isError ? "#b91c1c" : "#64748b",
							fontFamily: "sans-serif",
							fontSize: 10,
							fontWeight: 600,
							letterSpacing: "0.4px",
						}}
					>
						<span>工具输出</span>
						{result.status ? <span>{result.status}</span> : null}
					</div>
					<pre
						style={{
							margin: 0,
							maxHeight: compact ? 180 : 320,
							overflow: "auto",
							whiteSpace: "pre-wrap",
							wordBreak: "break-word",
							color: result.isError ? "#b91c1c" : "#334155",
							fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
							fontSize: 12,
							lineHeight: 1.6,
						}}
					>
						{formatToolResult(result)}
					</pre>
				</div>
			) : null}
		</div>
	);
}
