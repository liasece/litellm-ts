export default {
	preset: "ts-jest",
	testEnvironment: "node",
	moduleFileExtensions: ["ts", "tsx", "js", "jsx", "json", "node"],
	// isolatedModules：ts-jest 逐文件转译，不再为每个测试文件建完整 TS 程序做类型检查
	//（全量套件约 80s → 7s）。测试文件的类型由 `npm run test:types` 单独校验。
	transform: { "^.+\\.(ts|tsx)$": ["ts-jest", { tsconfig: "tsconfig.test.json", isolatedModules: true }] },
	testMatch: ["<rootDir>/src/**/*.test.ts", "<rootDir>/tests/**/*.test.ts"],
	testPathIgnorePatterns: ["/node_modules/", "/dist/"],
	modulePathIgnorePatterns: ["<rootDir>/dist/"],
	watchPathIgnorePatterns: ["<rootDir>/dist/"],
	cacheDirectory: ".cache/jest",
	maxWorkers: 4,
	moduleNameMapper: {
		"^(\\.{1,2}/.*)\\.js$": "$1",
	},
};
