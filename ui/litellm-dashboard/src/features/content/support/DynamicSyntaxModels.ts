export interface SyntaxSegment {
	types: string[];
	text: string;
}
export type SyntaxThemeName = "coy" | "one-light" | "prism";
export type SyntaxStyle = Record<string, string | number>;
