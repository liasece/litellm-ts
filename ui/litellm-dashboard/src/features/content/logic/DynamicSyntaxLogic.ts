import Prism from "../runtime/PrismRuntime";
import themesData from "../data/SyntaxThemes.json";
import type { SyntaxSegment, SyntaxStyle, SyntaxThemeName } from "../support/DynamicSyntaxModels";
const aliases: Readonly<Record<string, string>> = {
	py: "python",
	js: "javascript",
	ts: "typescript",
	sh: "bash",
	shell: "bash",
	yml: "yaml",
	html: "markup",
	xml: "markup",
};
const allowed = new Set(["python", "json", "javascript", "typescript", "jsx", "tsx", "bash", "yaml", "sql", "markup", "css"]);
const themes: Readonly<Record<SyntaxThemeName, Record<string, SyntaxStyle>>> = themesData;
type PrismToken = ReturnType<typeof Prism.tokenize>[number];
export function syntaxSegments(code: string, language: string): SyntaxSegment[] {
	const name = aliases[language.toLowerCase()] ?? language.toLowerCase(),
		grammar = allowed.has(name) ? Prism.languages[name] : undefined;
	if (!grammar) return [{ types: [], text: code }];
	const result: SyntaxSegment[] = [];
	function walk(node: PrismToken, parents: string[] = []): void {
		if (typeof node === "string") {
			result.push({ types: parents, text: node });
			return;
		}
		const types = Array.from(new Set([...parents, node.type, ...(typeof node.alias === "string" ? [node.alias] : (node.alias ?? []))]));
		if (typeof node.content === "string") result.push({ types, text: node.content });
		else if (Array.isArray(node.content)) node.content.forEach((child) => walk(child, types));
		else walk(node.content, types);
	}
	try {
		Prism.tokenize(code, grammar).forEach((node) => walk(node));
		return result;
	} catch {
		return [{ types: [], text: code }];
	}
}
function combinations(types: string[]): string[] {
	const result = [...types],
		values = types.slice(0, 4);
	function visit(chosen: string[], remaining: string[]) {
		if (chosen.length >= 2) result.push(chosen.join("."));
		for (let i = 0; i < remaining.length; i++)
			visit(
				[...chosen, remaining[i]],
				remaining.filter((_, index) => index !== i),
			);
	}
	visit([], values);
	return result;
}
export function syntaxTheme(name: SyntaxThemeName) {
	return themes[name];
}
export function syntaxSegmentStyle(theme: SyntaxThemeName, types: string[], base: SyntaxStyle = {}): SyntaxStyle {
	return Object.assign({}, base, ...combinations(types).map((type) => themes[theme][type] ?? {}));
}
const unitless = new Set([
	"animationIterationCount",
	"aspectRatio",
	"borderImageOutset",
	"borderImageSlice",
	"borderImageWidth",
	"boxFlex",
	"boxFlexGroup",
	"boxOrdinalGroup",
	"columnCount",
	"columns",
	"fillOpacity",
	"flex",
	"flexGrow",
	"flexPositive",
	"flexShrink",
	"flexNegative",
	"flexOrder",
	"fontWeight",
	"gridArea",
	"gridRow",
	"gridRowEnd",
	"gridRowSpan",
	"gridRowStart",
	"gridColumn",
	"gridColumnEnd",
	"gridColumnSpan",
	"gridColumnStart",
	"lineClamp",
	"lineHeight",
	"opacity",
	"order",
	"orphans",
	"scale",
	"stopOpacity",
	"strokeDasharray",
	"strokeDashoffset",
	"strokeMiterlimit",
	"strokeOpacity",
	"strokeWidth",
	"tabSize",
	"widows",
	"zIndex",
	"zoom",
]);
export function syntaxStyleUnits(style: SyntaxStyle): SyntaxStyle {
	return Object.fromEntries(
		Object.entries(style).map(([key, value]) => {
			const bare = key.replace(/^(?:Webkit|Moz|ms|O)(?=[A-Z])/, "").replace(/^./, (letter) => letter.toLowerCase());
			return [key, typeof value === "number" && value !== 0 && !key.startsWith("--") && !unitless.has(bare) ? value + "px" : value];
		}),
	);
}
