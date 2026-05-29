import type { Config } from "drizzle-kit";

export default {
	schema: "./src/db/schema/*.ts",
	out: "./drizzle",
	dialect: "postgresql",
	dbCredentials: {
		host: process.env["DATABASE_HOST"] ?? "192.168.1.220",
		port: Number(process.env["DATABASE_PORT"] ?? "37289"),
		database: process.env["DATABASE_NAME"] ?? "litellm",
		user: process.env["DATABASE_USER"] ?? "litellm",
		password: process.env["DATABASE_PASSWORD"] ?? "litellm123",
	},
} satisfies Config;
