import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type { MarkdownNode } from "../support/MarkdownModels";

const parser = unified().use(remarkParse).use(remarkGfm);
const commonmarkParser = unified().use(remarkParse);

export function parseMarkdown(source: string, gfm = true): MarkdownNode {
	return (gfm ? parser : commonmarkParser).parse(source) as unknown as MarkdownNode;
}

export function safeMarkdownUrl(value: string | undefined): string | undefined {
	if (!value) return undefined;
	const normalized = Array.from(value)
		.filter((character) => character.charCodeAt(0) > 32 && character.charCodeAt(0) !== 127)
		.join("");
	const protocol = /^([a-z][a-z0-9+.-]*):/i.exec(normalized);
	if (protocol && !["http", "https", "irc", "ircs", "mailto", "xmpp"].includes(protocol[1].toLowerCase())) return undefined;
	return value;
}
const RASTER_IMAGE_DATA = /^data:image\/(?:png|jpe?g|webp|gif);base64,/i;
export const isLocalImagePath = (value: string): boolean =>
	/^(?:\/(?:Users|home|root|mnt|tmp|var)\/|[a-z]:[\\/]|file:\/|sandbox:\/)/i.test(value);
export function resolveMarkdownImage(url: string | undefined, imageSources?: Readonly<Record<string, string>>): string | undefined {
	if (!url) return undefined;
	let source = imageSources?.[url];
	if (!source) {
		try {
			source = imageSources?.[decodeURIComponent(url)];
		} catch {
			/* Invalid escapes cannot identify a recorded image. */
		}
	}
	source ??= url;
	if (source.includes("litellm_truncated")) return undefined;
	if (RASTER_IMAGE_DATA.test(source)) return source;
	return safeMarkdownUrl(source);
}
export function markdownDefinitions(tree: MarkdownNode): Map<string, MarkdownNode> {
	const definitions = new Map<string, MarkdownNode>();
	function visit(node: MarkdownNode) {
		if (node.type === "definition" && node.identifier) definitions.set(node.identifier.toLowerCase(), node);
		for (const child of node.children ?? []) visit(child);
	}
	visit(tree);
	return definitions;
}
