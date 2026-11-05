/**
 * InputToolsList - Input 卡片内的 Tools 折叠列表
 *
 * pretty 视图顶部只用 tag 摘要工具名，看不到每个工具的描述与参数。这里在 Input 内提供两层折叠：
 * TOOLS 区块默认收起，展开后按请求顺序列出全部工具；每个工具再单独展开，才显示描述与参数。
 */

import { useState, type ReactNode } from "react";
import { Tag, Typography } from "antd";
import { DownOutlined, RightOutlined } from "@ant-design/icons";
import type { RequestTool } from "./prettyMessagesTypes";

const { Text } = Typography;

const MONO_FONT = "ui-monospace, SFMono-Regular, Menlo, monospace";

function formatJson(value: unknown): string {
	try {
		const serialized = JSON.stringify(value, null, 2);
		return serialized === undefined ? String(value) : serialized;
	} catch {
		return "[Unserializable tool definition]";
	}
}

interface CollapsibleHeaderProps {
	expanded: boolean;
	onToggle: () => void;
	children: ReactNode;
	padding?: string;
}

/** 折叠行头部：箭头、hover 反馈，键盘 Enter/空格也能切换。 */
function CollapsibleHeader({ expanded, onToggle, children, padding = "4px 0" }: CollapsibleHeaderProps) {
	const [isHovered, setIsHovered] = useState(false);

	return (
		<div
			role="button"
			tabIndex={0}
			aria-expanded={expanded}
			onClick={onToggle}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onToggle();
				}
			}}
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
			style={{
				display: "flex",
				alignItems: "center",
				gap: 6,
				cursor: "pointer",
				padding,
				borderRadius: 4,
				background: isHovered ? "#f5f5f5" : "transparent",
				transition: "background 0.15s ease",
			}}
		>
			{expanded ? (
				<DownOutlined style={{ fontSize: 10, color: "#8c8c8c" }} />
			) : (
				<RightOutlined style={{ fontSize: 10, color: "#8c8c8c" }} />
			)}
			{children}
		</div>
	);
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
	return (
		<div style={{ marginTop: 6 }}>
			<Text type="secondary" style={{ fontSize: 10, letterSpacing: "0.4px", textTransform: "uppercase" }}>
				{label}
			</Text>
			<pre
				style={{
					margin: "2px 0 0",
					maxHeight: 240,
					overflow: "auto",
					fontFamily: MONO_FONT,
					fontSize: 12,
					lineHeight: 1.6,
					whiteSpace: "pre-wrap",
					wordBreak: "break-word",
					color: "#262626",
				}}
			>
				{formatJson(value)}
			</pre>
		</div>
	);
}

function ToolDefinitionCard({ tool, index }: { tool: RequestTool; index: number }) {
	const [isExpanded, setIsExpanded] = useState(false);

	return (
		<div
			style={{
				border: "1px solid #e9ecef",
				borderRadius: 6,
				overflow: "hidden",
				background: "#fff",
				marginTop: 8,
			}}
		>
			<CollapsibleHeader expanded={isExpanded} onToggle={() => setIsExpanded(!isExpanded)} padding="8px 12px">
				<Text strong style={{ fontSize: 13 }}>
					{index + 1}. {tool.name}
				</Text>
				{tool.type !== "function" ? <Tag style={{ margin: 0, fontSize: 10 }}>{tool.type}</Tag> : null}
			</CollapsibleHeader>

			{isExpanded ? (
				<div style={{ padding: "8px 12px 10px", borderTop: "1px solid #f0f0f0" }}>
					{tool.description ? (
						<div
							style={{
								fontSize: 12,
								lineHeight: 1.6,
								color: "#595959",
								whiteSpace: "pre-wrap",
								wordBreak: "break-word",
							}}
						>
							{tool.description}
						</div>
					) : null}
					{tool.parameters !== undefined ? <JsonBlock label="Parameters" value={tool.parameters} /> : null}
					{tool.extra ? <JsonBlock label="Other fields" value={tool.extra} /> : null}
				</div>
			) : null}
		</div>
	);
}

interface InputToolsListProps {
	tools: RequestTool[];
}

export function InputToolsList({ tools }: InputToolsListProps) {
	const [isExpanded, setIsExpanded] = useState(false);

	if (tools.length === 0) {
		return null;
	}

	return (
		<div style={{ marginTop: 8 }}>
			<CollapsibleHeader expanded={isExpanded} onToggle={() => setIsExpanded(!isExpanded)}>
				<Text type="secondary" style={{ fontSize: 10, letterSpacing: "0.5px", textTransform: "uppercase" }}>
					TOOLS ({tools.length})
				</Text>
			</CollapsibleHeader>

			{/* A large tool set is common; render rows only while expanded. */}
			{isExpanded ? (
				<div style={{ paddingLeft: 16, borderLeft: "1px solid #f0f0f0" }}>
					{tools.map((tool, index) => (
						<ToolDefinitionCard key={`${tool.name}-${index}`} tool={tool} index={index} />
					))}
				</div>
			) : null}
		</div>
	);
}
