import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";
import unusedImports from "eslint-plugin-unused-imports";

export default defineConfig([
	...nextVitals,
	...nextTypescript,
	{
		files: ["**/*.{js,jsx,ts,tsx}"],
		plugins: {
			"unused-imports": unusedImports,
		},
		rules: {
			"unused-imports/no-unused-imports": "error",
			"@typescript-eslint/no-explicit-any": "off",
			"@typescript-eslint/no-unused-vars": "off",
			"@typescript-eslint/no-unused-expressions": "off",
			"@typescript-eslint/ban-ts-comment": "off",
			"prefer-const": "off",
			"no-empty": "off",
			"no-prototype-builtins": "off",
			"no-useless-catch": "off",
			"no-useless-escape": "off",
			"no-self-assign": "off",
			// The dashboard is a static export and renders authenticated blob URLs,
			// provider logos, and user-supplied images that cannot use next/image.
			"@next/next/no-img-element": "off",
			// React Compiler is not enabled (the project intentionally remains on
			// React 18); TanStack Table's stable APIs are therefore not a compiler
			// compatibility concern for this codebase.
			"react-hooks/incompatible-library": "off",
		},
	},
	prettier,
	globalIgnores([".next/**", "out/**", "build/**", "coverage/**", "next-env.d.ts"]),
]);
