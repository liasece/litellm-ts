<script setup lang="ts">
import { computed, h, useAttrs, type CSSProperties, type VNodeChild, type StyleValue } from "vue";
import { syntaxSegments, syntaxSegmentStyle, syntaxStyleUnits, syntaxTheme } from "../logic/DynamicSyntaxLogic";
import type { SyntaxStyle, SyntaxThemeName } from "../support/DynamicSyntaxModels";
defineOptions({ inheritAttrs: false });
const props = withDefaults(
	defineProps<{
		code: string;
		language?: string;
		theme?: SyntaxThemeName;
		customStyle?: CSSProperties;
		tokenStyleOverrides?: Readonly<Record<string, CSSProperties>>;
		showLineNumbers?: boolean;
		startingLineNumber?: number;
		lineNumberStyle?: CSSProperties;
		wrapLongLines?: boolean;
	}>(),
	{
		language: "text",
		theme: "coy",
		customStyle: undefined,
		tokenStyleOverrides: undefined,
		lineNumberStyle: undefined,
		startingLineNumber: 1,
	},
);
const attrs = useAttrs(),
	segments = computed(() => syntaxSegments(props.code, props.language));
function style(value: CSSProperties | SyntaxStyle | undefined): SyntaxStyle {
	return Object.fromEntries(
		Object.entries(value ?? {}).filter(
			(entry): entry is [string, string | number] => typeof entry[1] === "string" || typeof entry[1] === "number",
		),
	);
}
function node(text: string, types: string[]): VNodeChild {
	const theme = syntaxTheme(props.theme),
		classes = types.filter((type) => !theme[type]);
	return h(
		"span",
		{
			class: types.length ? ["token", ...classes].join(" ") : undefined,
			style: syntaxStyleUnits(
				Object.assign(syntaxSegmentStyle(props.theme, types), ...types.map((type) => style(props.tokenStyleOverrides?.[type]))),
			),
		},
		text,
	);
}
const CodeContent = () => {
	const theme = syntaxTheme(props.theme),
		rows: VNodeChild[] = [];
	let line = props.startingLineNumber;
	const largest = props.startingLineNumber + (props.code.match(/\n/g)?.length ?? 0);
	function lineNumber() {
		rows.push(
			h(
				"span",
				{
					class: "linenumber react-syntax-highlighter-line-number",
					style: syntaxStyleUnits(
						syntaxSegmentStyle(props.theme, ["comment", "linenumber"], {
							display: "inline-block",
							minWidth: String(largest).length + ".25em",
							paddingRight: "1em",
							textAlign: "right",
							userSelect: "none",
							...style(props.lineNumberStyle),
						}),
					),
				},
				String(line++),
			),
		);
	}
	if (props.showLineNumbers) lineNumber();
	for (const segment of segments.value) {
		if (!props.showLineNumbers) {
			rows.push(node(segment.text, segment.types));
			continue;
		}
		const parts = segment.text.split("\n");
		for (let index = 0; index < parts.length; index++) {
			if (parts[index]) rows.push(node(parts[index], segment.types));
			if (index < parts.length - 1) {
				rows.push(node("\n", segment.types));
				lineNumber();
			}
		}
	}
	const preStyle = syntaxStyleUnits({ ...theme['pre[class*="language-"]'], ...style(props.customStyle) }),
		codeStyle = syntaxStyleUnits({
			whiteSpace: props.wrapLongLines ? "pre-wrap" : "pre",
			...theme['code[class*="language-"]'],
			...theme['code[class*="language-' + props.language + '"]'],
		});
	return h("pre", { ...attrs, style: [preStyle, attrs.style] as StyleValue }, [
		h("code", { class: props.language ? "language-" + props.language : undefined, style: codeStyle }, rows),
	]);
};
</script>
<template><CodeContent /></template>
