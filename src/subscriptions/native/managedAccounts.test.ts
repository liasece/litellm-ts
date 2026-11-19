import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SubscriptionAccountStore } from "./accountStore";
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

it("投影账号行时保留账号页设置的 disabled/weight", async () => {
	const store = new SubscriptionAccountStore({ authDir: root });
	const key = commandCodeAccountFilename("cc_live_key");
	await store.writeRaw(key, { type: "commandcode", api_key: "cc_live_key", label: "Old", disabled: true, weight: 7 });
	await projectCommandCodeAccounts(store, [{ apiKey: "cc_live_key", label: "Primary" }]);
	const projected = await store.findByKey(key);
	expect(projected?.raw).toMatchObject({ type: "commandcode", api_key: "cc_live_key", label: "Primary", disabled: true, weight: 7 });
});

it("托管账户从配置移除后进回收站，重新加入时恢复同一条账号行", async () => {
	const store = new SubscriptionAccountStore({ authDir: root });
	const key = commandCodeAccountFilename("cc_live_key");
	await projectCommandCodeAccounts(store, [{ apiKey: "cc_live_key", label: "Primary" }]);
	const created = await store.findByKey(key);
	expect(created).toBeDefined();

	await projectCommandCodeAccounts(store, []);
	expect(await store.findByKey(key)).toBeUndefined();
	const trashed = await store.listTrashed();
	expect(trashed.map((account) => account.key)).toEqual([key]);

	await projectCommandCodeAccounts(store, [{ apiKey: "cc_live_key", label: "Primary" }]);
	const restored = await store.findByKey(key);
	expect(restored?.id).toBe(created?.id);
	expect(await store.listTrashed()).toEqual([]);
});

it("投影不会把已撤销的托管账号复活", async () => {
	const store = new SubscriptionAccountStore({ authDir: root });
	const key = commandCodeAccountFilename("cc_live_key");
	await projectCommandCodeAccounts(store, [{ apiKey: "cc_live_key", label: "Primary" }]);
	const created = await store.findByKey(key);
	await store.archive(created!.id);

	await projectCommandCodeAccounts(store, [{ apiKey: "cc_live_key", label: "Primary" }]);
	// 配置里仍保留该 key：投影只更新正文，恢复要人工确认。
	expect(await store.findByKey(key)).toBeUndefined();
});
