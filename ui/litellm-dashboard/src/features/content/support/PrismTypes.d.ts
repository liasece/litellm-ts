declare module "prismjs/components/prism-core" {
	interface Grammar {
		[key: string]: unknown;
	}
	interface Token {
		type: string;
		alias?: string | string[];
		content: TokenContent;
	}
	type TokenContent = string | Token | (string | Token)[];
	const Prism: {
		manual: boolean;
		disableWorkerMessageHandler: boolean;
		languages: Record<string, Grammar>;
		tokenize(code: string, grammar: Grammar): (string | Token)[];
	};
	export default Prism;
}
declare module "prismjs/components/prism-markup";
declare module "prismjs/components/prism-css";
declare module "prismjs/components/prism-clike";
declare module "prismjs/components/prism-javascript";
declare module "prismjs/components/prism-typescript";
declare module "prismjs/components/prism-jsx";
declare module "prismjs/components/prism-tsx";
declare module "prismjs/components/prism-json";
declare module "prismjs/components/prism-python";
declare module "prismjs/components/prism-bash";
declare module "prismjs/components/prism-yaml";
declare module "prismjs/components/prism-sql";
