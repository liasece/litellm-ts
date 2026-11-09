<script lang="ts">
import { computed, defineComponent, h, type PropType, type VNode, type VNodeChild } from "vue";
import { parseMarkdown, safeMarkdownUrl, resolveMarkdownImage, markdownDefinitions } from "../logic/MarkdownLogic";
import CodeHighlightComponent from "./CodeHighlightComponent.vue";
import MarkdownImageComponent from "./MarkdownImageComponent.vue";
import PrivacyPlaceholderText from "./PrivacyPlaceholderText.vue";
import type { MarkdownNode } from "../support/MarkdownModels";

export default defineComponent({
	name: "MarkdownContent",
	props: {
		source: { type: String, required: true },
		gfm: { type: Boolean, default: true },
		linkTarget: { type: String, default: undefined },
		imageSources: { type: Object as PropType<Readonly<Record<string, string>>>, default: undefined },
		imagePreview: { type: Boolean, default: false },
		localImageFallback: { type: Boolean, default: false },
		highlightCode: { type: Boolean, default: false },
		wrapCodeLines: { type: Boolean, default: false },
	},
	setup(props) {
		const tree = computed(() => parseMarkdown(props.source, props.gfm));
		const definitions = computed(() => markdownDefinitions(tree.value));
		const footnotes = computed(() => {
			const result: MarkdownNode[] = [];
			function visit(node: MarkdownNode) {
				if (node.type === "footnoteDefinition") result.push(node);
				else for (const child of node.children ?? []) visit(child);
			}
			visit(tree.value);
			return result;
		});
		const footnoteNumbers = computed(() => new Map(footnotes.value.map((node, index) => [node.identifier, index + 1])));
		/**
		 * 文本节点里出现脱敏占位符时换成带样式的片段，其余情况保持原始字符串。
		 * @param value - 文本
		 */
		function text(value: string): string | VNode {
			return value.includes("{{") ? h(PrivacyPlaceholderText, { text: value }) : value;
		}
		function children(node: MarkdownNode): VNodeChild[] {
			return (node.children ?? []).map(renderNode);
		}
		function renderTable(node: MarkdownNode): VNodeChild {
			const rows = node.children ?? [];
			function row(rowNode: MarkdownNode, heading: boolean): VNodeChild {
				return h(
					"tr",
					(rowNode.children ?? []).map((cell, index) =>
						h(heading ? "th" : "td", { style: { textAlign: node.align?.[index] ?? undefined } }, children(cell)),
					),
				);
			}
			return h("table", [
				rows[0] ? h("thead", [row(rows[0], true)]) : null,
				h(
					"tbody",
					rows.slice(1).map((item) => row(item, false)),
				),
			]);
		}
		function renderNode(node: MarkdownNode): VNodeChild {
			switch (node.type) {
				case "root":
					return children(node);
				case "text":
					return text(node.value ?? "");
				case "paragraph":
					return h("p", children(node));
				case "heading":
					return h("h" + Math.min(6, Math.max(1, node.depth ?? 1)), children(node));
				case "strong":
					return h("strong", children(node));
				case "emphasis":
					return h("em", children(node));
				case "delete":
					return h("del", children(node));
				case "inlineCode":
					return h("code", text(node.value ?? ""));
				case "code":
					if (props.highlightCode && node.lang && /^\w+/.test(node.lang)) {
						return h(CodeHighlightComponent, {
							code: node.value ?? "",
							language: node.lang,
							theme: "coy",
							wrapLongLines: props.wrapCodeLines,
							customStyle: { borderRadius: "6px", margin: "0.5em 0" },
						});
					}
					return h("pre", [
						h("code", { class: node.lang ? "language-" + node.lang : undefined }, text((node.value ?? "") + "\n")),
					]);
				case "link":
					return h(
						"a",
						{
							href: safeMarkdownUrl(node.url),
							title: node.title ?? undefined,
							target: props.linkTarget,
							rel: props.linkTarget === "_blank" ? "noopener noreferrer" : undefined,
						},
						children(node),
					);
				case "linkReference": {
					const definition = definitions.value.get((node.identifier ?? "").toLowerCase());
					return definition
						? h(
								"a",
								{
									href: safeMarkdownUrl(definition.url),
									title: definition.title ?? undefined,
									target: props.linkTarget,
									rel: props.linkTarget === "_blank" ? "noopener noreferrer" : undefined,
								},
								children(node),
							)
						: children(node);
				}
				case "imageReference":
				case "image": {
					const definition = node.type === "imageReference" ? definitions.value.get((node.identifier ?? "").toLowerCase()) : node;
					return h(MarkdownImageComponent, {
						src: resolveMarkdownImage(definition?.url, props.imageSources),
						alt: node.alt ?? node.label ?? "",
						title: definition?.title ?? undefined,
						preview: props.imagePreview,
						localFallback: props.localImageFallback,
					});
				}
				case "footnoteReference": {
					const number = footnoteNumbers.value.get(node.identifier) ?? 1;
					return h("sup", [
						h(
							"a",
							{
								href: "#fn-" + encodeURIComponent(node.identifier ?? ""),
								id: "fnref-" + encodeURIComponent(node.identifier ?? ""),
								"data-footnote-ref": "",
								"aria-describedby": "footnote-label",
							},
							String(number),
						),
					]);
				}
				case "footnoteDefinition":
					return null;
				case "blockquote":
					return h("blockquote", children(node));
				case "thematicBreak":
					return h("hr");
				case "break":
					return h("br");
				case "list":
					return h(
						node.ordered ? "ol" : "ul",
						{
							start: node.ordered && node.start !== 1 ? node.start : undefined,
							class: node.children?.some((item) => item.checked !== null && item.checked !== undefined)
								? "contains-task-list"
								: undefined,
						},
						children(node),
					);
				case "listItem":
					return h(
						"li",
						{
							class: node.checked !== null && node.checked !== undefined ? "task-list-item" : undefined,
						},
						[
							node.checked !== null && node.checked !== undefined
								? h("input", { type: "checkbox", checked: node.checked, disabled: true })
								: null,
							...children(node),
						],
					);
				case "table":
					return renderTable(node);
				case "html":
					return text(node.value ?? "");
				case "definition":
					return null;
				default:
					return node.children ? children(node) : (node.value ?? "");
			}
		}
		return () =>
			h("div", { class: "markdown-content" }, [
				...children(tree.value),
				footnotes.value.length
					? h("section", { "data-footnotes": "", class: "footnotes" }, [
							h("h2", { class: "sr-only", id: "footnote-label" }, "Footnotes"),
							h(
								"ol",
								footnotes.value.map((node) =>
									h("li", { id: "fn-" + encodeURIComponent(node.identifier ?? "") }, [
										...children(node),
										h(
											"a",
											{
												href: "#fnref-" + encodeURIComponent(node.identifier ?? ""),
												"data-footnote-backref": "",
												"aria-label": "Back to reference",
											},
											"↩",
										),
									]),
								),
							),
						])
					: null,
			]);
	},
});
</script>

<style>
.markdown-content {
	overflow-wrap: anywhere;
}
.markdown-content > :first-child {
	margin-top: 0;
}
.markdown-content > :last-child {
	margin-bottom: 0;
}
.markdown-content p {
	margin: 0 0 1em;
}
.markdown-content h1,
.markdown-content h2,
.markdown-content h3 {
	margin: 1em 0 0.5em;
	font-weight: 600;
}
.markdown-content h1 {
	font-size: 2em;
}
.markdown-content h2 {
	font-size: 1.5em;
}
.markdown-content h3 {
	font-size: 1.25em;
}
.markdown-content a {
	color: #1677ff;
	text-decoration: none;
}
.markdown-content a:hover {
	text-decoration: underline;
}
.markdown-content pre {
	overflow: auto;
	padding: 12px 16px;
	border-radius: 6px;
	background: #f3f4f6;
	white-space: pre;
}
.markdown-content code {
	font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
	font-size: 0.875em;
}
.markdown-content :not(pre) > code {
	padding: 0.15em 0.3em;
	border-radius: 4px;
	background: #f3f4f6;
}
.markdown-content ul,
.markdown-content ol {
	padding-left: 1.5em;
	margin: 0.5em 0 1em;
}
.markdown-content ul {
	list-style: disc;
}
.markdown-content ol {
	list-style: decimal;
}
.markdown-content blockquote {
	margin: 1em 0;
	padding-left: 1em;
	border-left: 3px solid #d1d5db;
	color: #6b7280;
}
.markdown-content table {
	border-collapse: collapse;
	max-width: 100%;
	margin: 1em 0;
}
.markdown-content th,
.markdown-content td {
	padding: 6px 12px;
	border: 1px solid #d1d5db;
}
.markdown-content th {
	background: #f9fafb;
	font-weight: 600;
}
.markdown-content img {
	max-width: 100%;
	height: auto;
}
.markdown-content .task-list-item {
	list-style: none;
}
.markdown-content .task-list-item input {
	margin: 0 0.4em 0 -1.4em;
}
</style>
