export interface MarkdownNode {
	type: string;
	value?: string;
	children?: MarkdownNode[];
	url?: string;
	title?: string | null;
	depth?: number;
	ordered?: boolean;
	start?: number | null;
	checked?: boolean | null;
	align?: Array<"left" | "right" | "center" | null>;
	identifier?: string;
	label?: string;
	alt?: string;
	lang?: string | null;
	spread?: boolean;
	referenceType?: string;
}
