import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
	commandCodeAccountFilename,
	extractManagedCommandCodeAccounts,
	importLegacyManagedConfig,
	parseUserConfig,
	projectCommandCodeAccounts,
	serializeUserConfig,
	setManagedCommandCodeAccounts,
} from "./managedAccounts";

let root: string;

beforeEach(async () => {
	root = await mkdtemp(path.join(os.tmpdir(), "subscription-managed-"));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

it("保留旧 config.yaml 的 plugins 与系统字段，不因迁移丢失 CommandCode 账户", () => {
	const source = [
		"auth-dir: /var/lib/litellm/cliproxy/auths",
		"port: 8317",
		"plugins:",
		"  managed-accounts:",
		"    commandcode:",
		"      - api-key: cc_live_key",
		"        label: Primary",
	].join("\n");
	const config = parseUserConfig(source);
	expect(config["auth-dir"]).toBe("/var/lib/litellm/cliproxy/auths");
	expect(extractManagedCommandCodeAccounts(config)).toEqual([{ apiKey: "cc_live_key", label: "Primary" }]);
	const roundTrip = parseUserConfig(serializeUserConfig(config));
	expect(extractManagedCommandCodeAccounts(roundTrip)).toEqual([{ apiKey: "cc_live_key", label: "Primary" }]);
});

it("写回托管账户时保留其他插件配置", () => {
	const config = parseUserConfig("plugins:\n  other:\n    enabled: true\n");
	setManagedCommandCodeAccounts(config, [{ "api-key": "cc_new", label: "New" }]);
	expect(config["plugins"]).toMatchObject({ other: { enabled: true } });
	expect(extractManagedCommandCodeAccounts(config)).toEqual([{ apiKey: "cc_new", label: "New" }]);
});

it("数据库没有设置时只从旧 config.yaml 迁移 plugins", async () => {
	await writeFile(
		path.join(root, "config.yaml"),
		"port: 8317\nauth-dir: /tmp/auths\nplugins:\n  managed-accounts:\n    commandcode:\n      - api-key: cc_legacy\n",
	);
	const imported = await importLegacyManagedConfig(path.join(root, "auths"));
	expect(imported).toContain("plugins");
	expect(imported).not.toContain("port");
	expect(extractManagedCommandCodeAccounts(parseUserConfig(imported ?? ""))).toEqual([{ apiKey: "cc_legacy", label: "CommandCode" }]);
});

it("投影 auth 文件时保留账号页设置的 disabled/weight", async () => {
	const filename = commandCodeAccountFilename("cc_live_key");
	await writeFile(
		path.join(root, filename),
		JSON.stringify({ type: "commandcode", api_key: "cc_live_key", label: "Old", disabled: true, weight: 7 }),
	);
	await projectCommandCodeAccounts(root, [{ apiKey: "cc_live_key", label: "Primary" }]);
	const projected = JSON.parse(await readFile(path.join(root, filename), "utf8")) as Record<string, unknown>;
	expect(projected).toMatchObject({ type: "commandcode", api_key: "cc_live_key", label: "Primary", disabled: true, weight: 7 });
});
