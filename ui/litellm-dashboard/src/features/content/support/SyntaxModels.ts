export interface SyntaxElement {
	tag: string;
	attributes: { class?: string; style?: string };
	children: SyntaxNode[];
}
export type SyntaxNode = string | SyntaxElement;
