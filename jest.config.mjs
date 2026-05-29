export default {
	preset: "ts-jest",
	testEnvironment: "node",
	moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
	transform: { "^.+\\.(ts|tsx)$": ["ts-jest", { tsconfig: "tsconfig.test.json" }] },
	testMatch: ["<rootDir>/src/**/*.test.ts", "<rootDir>/tests/**/*.test.ts"],
	testPathIgnorePatterns: ["/node_modules/", "/dist/"],
	modulePathIgnorePatterns: ["<rootDir>/dist/"],
	watchPathIgnorePatterns: ["<rootDir>/dist/"],
	cacheDirectory: ".cache/jest",
	moduleNameMapper: {
		"^(\\.{1,2}/.*)\\.js$": "$1",
	},
};
