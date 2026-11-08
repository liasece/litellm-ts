import type { SyntaxElement } from "../../content/support/SyntaxModels";
export type { SyntaxElement, SyntaxNode } from "../../content/support/SyntaxModels";
export interface ApiReferenceExample {
	key: string;
	label: string;
	code: string;
	tree: SyntaxElement;
}
