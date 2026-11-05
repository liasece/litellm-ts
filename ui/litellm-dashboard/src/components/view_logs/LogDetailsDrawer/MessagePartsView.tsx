import { Image, Typography } from "antd";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { MessagePart } from "./prettyMessagesTypes";
import { SimpleToolCallBlock } from "./SimpleToolCallBlock";

const { Text } = Typography;
const TRUNCATED_IMAGE_MESSAGE = "图片数据在日志入库时被截断，无法显示。";

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

type ImageSources = Readonly<Record<string, string>>;
const RASTER_IMAGE_DATA = /^data:image\/(?:png|jpe?g|webp|gif);base64,/i;
const LOCAL_IMAGE_PATH = /^(?:\/(?:Users|home|root|mnt|tmp|var)\/|[a-z]:[\\/]|file:\/|sandbox:\/)/i;

function MarkdownText({ children, imageSources }: { children: string; imageSources?: ImageSources }) {
	return (
		<ReactMarkdown
			remarkPlugins={[remarkGfm]}
			urlTransform={(url, key, node) => {
				if (key === "src" && node.tagName === "img") {
					let source = imageSources?.[url];
					if (!source) {
						try {
							source = imageSources?.[decodeURIComponent(url)];
						} catch {
							// Invalid percent escapes cannot identify a recorded image.
						}
					}
					source ??= url;
					if (RASTER_IMAGE_DATA.test(source) && !source.includes("litellm_truncated")) return source;
					return defaultUrlTransform(source);
				}
				return defaultUrlTransform(url);
			}}
			components={{
				p: ({ children: paragraph }) => <div style={{ margin: "0 0 6px" }}>{paragraph}</div>,
				img: ({ src, alt }) => {
					if (!src || LOCAL_IMAGE_PATH.test(src)) {
						return (
							<span className="inline-flex flex-col gap-1 rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-500">
								{alt ? <span className="font-medium text-slate-700">{alt}</span> : null}
								<span>
									{src && LOCAL_IMAGE_PATH.test(src)
										? "图片保存在生成设备上，日志中没有可显示的图片数据。"
										: "日志中的图片地址或数据不可用。"}
								</span>
							</span>
						);
					}
					return (
						<Image
							src={src}
							alt={alt || "图片"}
							wrapperStyle={{ maxWidth: "100%" }}
							style={{ display: "block", maxWidth: "100%", maxHeight: 640, objectFit: "contain", borderRadius: 6 }}
						/>
					);
				},
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

function renderableImageSource(part: MessagePart): string | null {
	const data = part.data && typeof part.data === "object" ? (part.data as Record<string, unknown>) : null;
	const candidate = typeof data?.src === "string" ? data.src : part.text;
	if (typeof candidate !== "string") return null;
	if (candidate.includes("litellm_truncated")) return null;
	return /^(?:data:image\/(?:png|jpe?g|webp|gif);base64,|https?:\/\/)/i.test(candidate) ? candidate : null;
}

function ImagePart({
	part,
	compact,
	imageSources,
}: {
	part: MessagePart;
	compact: boolean;
	imageSources?: ImageSources;
}) {
	const source = renderableImageSource(part);
	if (!source) {
		const data = part.data && typeof part.data === "object" ? (part.data as Record<string, unknown>) : null;
		const truncated = data?.truncated === true || part.text?.includes("litellm_truncated");
		return (
			<OperationPart
				part={truncated ? { ...part, text: TRUNCATED_IMAGE_MESSAGE, data: { truncated: true } } : part}
				compact={compact}
				imageSources={imageSources}
			/>
		);
	}
	const caption = part.text && part.text !== source ? part.text : "";
	const tone = PART_TONES.image;

	return (
		<div
			data-message-part="image"
			style={{
				background: tone.background,
				border: `1px solid ${tone.border}`,
				borderRadius: 6,
				padding: compact ? "7px 10px" : "10px 12px",
				marginTop: 8,
			}}
		>
			<div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
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
				{part.status ? (
					<Text type={part.isError ? "danger" : "secondary"} style={{ fontSize: 11 }}>
						{part.status}
					</Text>
				) : null}
			</div>
			<Image
				src={source}
				alt={caption || part.label || "Generated image"}
				style={{
					display: "block",
					maxWidth: "100%",
					maxHeight: compact ? 360 : 640,
					objectFit: "contain",
					borderRadius: 6,
				}}
			/>
			{caption ? (
				<div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.6, color: "#475569" }}>
					<MarkdownText imageSources={imageSources}>{caption}</MarkdownText>
				</div>
			) : null}
		</div>
	);
}

function OperationPart({
	part,
	compact,
	imageSources,
}: {
	part: MessagePart;
	compact: boolean;
	imageSources?: ImageSources;
}) {
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
	const structuredParts = part.parts?.length ? part.parts : undefined;

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
			<div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: detail || structuredParts ? 6 : 0 }}>
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
			{structuredParts ? (
				<MessagePartsView parts={structuredParts} compact={compact} imageSources={imageSources} />
			) : detail && (part.kind === "thinking" || part.kind === "refusal") ? (
				<div style={{ fontSize: 12, lineHeight: 1.6, color: "#262626" }}>
					<MarkdownText imageSources={imageSources}>{detail}</MarkdownText>
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

export function MessagePartsView({
	parts,
	compact = false,
	imageSources,
}: {
	parts: MessagePart[];
	compact?: boolean;
	imageSources?: ImageSources;
}) {
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
							<MarkdownText imageSources={imageSources}>{part.text || ""}</MarkdownText>
						</div>
					);
				}
				if (part.kind === "tool_call") {
					const result = toolResultsByCallIndex.get(index);
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
							result={result}
							resultContent={
								result?.parts?.length ? (
									<MessagePartsView parts={result.parts} compact={compact} imageSources={imageSources} />
								) : undefined
							}
						/>
					);
				}
				if (part.kind === "image") {
					return (
						<ImagePart
							key={`${part.kind}-${part.id || index}`}
							part={part}
							compact={compact}
							imageSources={imageSources}
						/>
					);
				}
				return (
					<OperationPart
						key={`${part.kind}-${part.id || index}`}
						part={part}
						compact={compact}
						imageSources={imageSources}
					/>
				);
			})}
		</div>
	);
}
