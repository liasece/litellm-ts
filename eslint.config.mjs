import path from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import";
import jsdoc from "eslint-plugin-jsdoc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
	baseDirectory: __dirname,
	recommendedConfig: js.configs.recommended,
	allConfig: js.configs.all,
});

const namingConventionClassFieldSelector = ["classicAccessor", "autoAccessor", "classMethod", "classProperty"];

export default [
	{
		ignores: [
			"**/*.js",
			"**/*.d.ts",
			"**/*.mjs",
			"**/*.cjs",
			"dist/**",
			"node_modules/**",
			"scripts/**",
			"drizzle.config.ts",
			"tests/**",
			"**/*.test.ts",
			"ui/**",
			"src/db/schema/**/*.ts",
		],
	},
	...compat.extends("eslint:recommended", "plugin:@typescript-eslint/recommended"),
	{
		files: ["src/**/*.ts"],
		plugins: {
			"@typescript-eslint": typescriptEslint,
			import: importPlugin,
		},
		settings: {
			"import/resolver": {
				node: {
					extensions: [".ts"],
				},
			},
			"import/cache": {
				lifetime: "Infinity",
			},
		},
		languageOptions: {
			parser: tsParser,
			ecmaVersion: "latest",
			sourceType: "commonjs",
			parserOptions: {
				project: "./tsconfig.json",
			},
		},
		rules: {
			"prefer-arrow-callback": ["error", { allowNamedFunctions: false, allowUnboundThis: false }],
			"object-shorthand": ["error", "never"],
			"max-params": ["error", 6],
			"max-depth": ["error", 6],
			"no-unused-vars": "off",
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					args: "none",
					caughtErrors: "none",
					destructuredArrayIgnorePattern: "^_",
					ignoreRestSiblings: true,
				},
			],
			"@typescript-eslint/no-unsafe-function-type": "off",
			"@typescript-eslint/no-empty-object-type": "off",
			"@typescript-eslint/no-wrapper-object-types": "off",
			"@typescript-eslint/consistent-type-imports": ["error", { "fixStyle": "separate-type-imports", "disallowTypeAnnotations": false }],
			"@typescript-eslint/restrict-plus-operands": "error",
			"@typescript-eslint/no-namespace": "off",
			"@typescript-eslint/ban-types": "off",
			curly: "error",
			"array-callback-return": "error",
			"no-constant-binary-expression": "error",
			"no-constructor-return": "error",
			"no-new-native-nonconstructor": "error",
			"no-self-compare": "error",
			"no-template-curly-in-string": "error",
			"no-unmodified-loop-condition": "error",
			"rest-spread-spacing": "error",
			"object-property-newline": ["error", { allowAllPropertiesOnSameLine: true }],
			"no-trailing-spaces": "error",
			"no-multiple-empty-lines": "error",
			"no-multi-spaces": "error",
				"lines-between-class-members": [
					"error",
					{
						enforce: [
							{ blankLine: "always", prev: "method", next: "method" },
							{ blankLine: "always", prev: "method", next: "field" },
						],
					},
				],
			"default-case": "error",
			"default-case-last": "error",
			"grouped-accessor-pairs": "error",
			"no-alert": "error",
			"no-caller": "error",
			"no-confusing-arrow": "error",
			"no-div-regex": "error",
			"no-extend-native": "error",
			"no-sequences": "error",
			"no-var": "error",
			"prefer-const": "error",
			"prefer-exponentiation-operator": "error",
			"prefer-rest-params": "error",
			yoda: "error",
			"@typescript-eslint/prefer-regexp-exec": "error",
			"@typescript-eslint/no-unsafe-return": "off",
			"@typescript-eslint/no-unused-expressions": "error",
			"no-mixed-spaces-and-tabs": "off",
			"no-inner-declarations": "off",
			"no-prototype-builtins": "error",
			"@typescript-eslint/no-explicit-any": "error",
			"@typescript-eslint/naming-convention": [
				"error",
				{
					selector: "classProperty",
					modifiers: ["static", "readonly"],
					format: ["UPPER_CASE"],
					leadingUnderscore: "forbid",
				},
				{
					selector: namingConventionClassFieldSelector,
					modifiers: ["private"],
					format: ["camelCase"],
					leadingUnderscore: "require",
				},
				{
					selector: "parameterProperty",
					modifiers: ["private"],
					format: ["camelCase"],
					leadingUnderscore: "require",
				},
				{
					selector: ["classMethod", "classProperty"],
					modifiers: ["public"],
					format: ["camelCase", "PascalCase"],
					leadingUnderscore: "allow",
				},
				{
					selector: namingConventionClassFieldSelector,
					modifiers: ["public"],
					format: ["camelCase", "UPPER_CASE", "PascalCase"],
					leadingUnderscore: "forbid",
				},
				{
					selector: ["typeAlias", "interface", "enum", "class"],
					format: null,
					modifiers: ["exported"],
					custom: {
						regex: "^[A-Z][0-9A-Za-z_]*$",
						match: true,
					},
				},
			],
			"no-restricted-syntax": [
				"error",
				{
					selector: "ExportNamedDeclaration[source]",
					message: "禁止使用桶导出 (re-export)，请直接从源文件导入",
				},
				{
					selector: "ExportAllDeclaration",
					message: "禁止使用 export * 桶导出，请直接从源文件导入",
				},
			],
		},
	},
	{
		plugins: {
			jsdoc,
		},
		files: ["src/**/*.ts"],
		rules: {
			"jsdoc/require-jsdoc": [
				"error",
				{
					contexts: [
						"TSInterfaceDeclaration",
						"TSMethodSignature",
						"TSPropertySignature",
						"TSEnumDeclaration",
						"TSEnumMember",
						"TSTypeAliasDeclaration",
					],
					publicOnly: true,
					require: {
						ArrowFunctionExpression: true,
						ClassDeclaration: true,
						ClassExpression: true,
						FunctionDeclaration: true,
						FunctionExpression: true,
						MethodDefinition: true,
					},
					checkConstructors: false,
				},
			],
			"jsdoc/check-access": "error",
			"jsdoc/check-alignment": "error",
			"jsdoc/check-line-alignment": "error",
			"jsdoc/check-param-names": ["error", { checkDestructured: false }],
			"jsdoc/check-template-names": "error",
			"jsdoc/check-property-names": "error",
			"jsdoc/check-syntax": "error",
			"jsdoc/check-tag-names": "error",
			"jsdoc/check-types": "error",
			"jsdoc/check-values": "error",
			"jsdoc/empty-tags": "error",
			"jsdoc/implements-on-classes": "error",
			"jsdoc/match-description": ["off",
				"error",
				{
					matchDescription: "^[一-龥A-Za-z`\\d_]+[\\s\\S]*$",
					message: "描述必须以有效字符开头",
				},
			],
			"jsdoc/multiline-blocks": "error",
			"jsdoc/no-bad-blocks": "error",
			"jsdoc/no-blank-block-descriptions": "error",
			"jsdoc/no-defaults": "error",
			"jsdoc/require-asterisk-prefix": "error",
			"jsdoc/no-multi-asterisks": "error",
			"jsdoc/no-undefined-types": "error",
			"jsdoc/require-description": "off",
			"jsdoc/require-hyphen-before-param-description": "error",
			"jsdoc/require-param": ["error", { unnamedRootBase: ["arg"], checkDestructured: false }],
			"jsdoc/require-param-description": "off",
			"jsdoc/require-param-name": ["error"],
			"jsdoc/require-property": "error",
			"jsdoc/require-property-description": "error",
			"jsdoc/require-property-name": "error",
			"jsdoc/require-property-type": "error",
			"jsdoc/require-returns": "off",
			"jsdoc/require-returns-check": "error",
			"jsdoc/require-returns-description": "error",
			"jsdoc/require-template": "error",
			"jsdoc/require-throws": "error",
			"jsdoc/require-yields": "error",
			"jsdoc/require-yields-check": "error",
			"jsdoc/sort-tags": "error",
			"jsdoc/tag-lines": "error",
			"jsdoc/valid-types": "error",
		},
	},
	// UI (litellm-dashboard) 专用 ESLint 配置
	{
		files: ["ui/litellm-dashboard/**/*.{ts,tsx}"],
		ignores: [
			"ui/litellm-dashboard/node_modules/**",
			"ui/litellm-dashboard/.next/**",
			"ui/litellm-dashboard/out/**",
			"ui/litellm-dashboard/coverage/**",
			"ui/litellm-dashboard/e2e_tests/**",
			"ui/litellm-dashboard/scripts/**",
			"ui/litellm-dashboard/tests/**",
		],
		languageOptions: {
			parser: tsParser,
			ecmaVersion: "latest",
			sourceType: "module",
			parserOptions: {
				project: "./ui/litellm-dashboard/tsconfig.json",
				tsconfigRootDir: __dirname,
				ecmaFeatures: {
					jsx: true,
				},
			},
		},
		settings: {
			"import/resolver": {
				node: {
					extensions: [".ts", ".tsx"],
				},
			},
		},
		plugins: {
			"@typescript-eslint": typescriptEslint,
			// 最小占位插件：仅为了让 UI 源码中已有的 eslint-disable 注释可解析
			"react-hooks": {
				rules: {
					"exhaustive-deps": {
						create() {
							return {};
						},
					},
				},
			},
			"@next/next": {
				rules: {
					"no-img-element": {
						create() {
							return {};
						},
					},
				},
			},
			react: {
				rules: {
					"no-unescaped-entities": {
						create() {
							return {};
						},
					},
				},
			},
		},
		rules: {
			"@typescript-eslint/no-explicit-any": "off",
			"@typescript-eslint/no-unused-vars": "off",
			"@typescript-eslint/no-unused-expressions": "off",
			"@typescript-eslint/ban-ts-comment": "off",
			"@typescript-eslint/no-require-imports": "off",
			"prefer-const": "off",
			"no-empty": "off",
			"no-prototype-builtins": "off",
			"no-useless-catch": "off",
			"no-useless-escape": "off",
			"no-self-assign": "off",
			"no-constant-binary-expression": "off",
			// 关闭后端强制的 strict 规则，UI 有自己的风格
			"prefer-arrow-callback": "off",
			"object-shorthand": "off",
			camelcase: "off",
			curly: "off",
			"no-restricted-syntax": "off",
			"jsdoc/require-jsdoc": "off",
		},
	},
];
