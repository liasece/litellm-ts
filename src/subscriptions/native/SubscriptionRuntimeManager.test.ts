import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ConfigRepository } from "../../repositories/ConfigRepository";
import { LEGACY_ACCOUNT_IMPORT_STATE_PARAM, SubscriptionAccountStore } from "./accountStore";
import { MemorySubscriptionAccountPersistence } from "./accountPersistence";
import { SubscriptionRuntimeManager } from "./SubscriptionRuntimeManager";
import { commandCodeAccountFilename } from "./managedAccounts";
import type { SubscriptionProviderLookup } from "./bridge";

/** 只在内存里保存参数的管理面配置仓库，覆盖 purge 需要读取的设置与投影。 */
function createRuntime(options: { authDir: string; params?: Map<string, Record<string, unknown>>; accounts?: SubscriptionAccountStore }) {
	const params = options.params ?? new Map<string, Record<string, unknown>>();
	const repository = {
		getParam: async (name: string) => params.get(name) ?? null,
		upsertParam: async (name: string, value: unknown) => {
			params.set(name, value as Record<string, unknown>);
		},
		deleteField: async () => null,
	} as unknown as ConfigRepository;
	const accounts =
		options.accounts ??
		new SubscriptionAccountStore({
			persistence: new MemorySubscriptionAccountPersistence(),
			authDir: options.authDir,
		});
	const providers: SubscriptionProviderLookup = { get: () => undefined, list: () => [] };
	const runtime = new SubscriptionRuntimeManager(repository, "test-master-key", { accounts: accounts, providers: providers });
	return { runtime: runtime, accounts: accounts, params: params };
}

let root: string;

beforeEach(async () => {
	root = await mkdtemp(path.join(os.tmpdir(), "subscription-runtime-manager-"));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

describe("SubscriptionRuntimeManager account purge", () => {
	it("refuses to purge an active account so deletion always goes through the trash", async () => {
		const { runtime, accounts } = createRuntime({ authDir: root });
		await runtime.addCommandCodeAccount("cc-active-key", "Active");
		const [active] = await runtime.listAccounts();
		expect(active).toBeDefined();

		await expect(runtime.purgeAccount(active!.auth_index)).rejects.toThrow("请先将订阅账号移入回收站");
		expect((await runtime.listAccounts()).map((account) => account.auth_index)).toEqual([active!.auth_index]);
		expect(await accounts.findById(active!.auth_index)).toBeDefined();
	});

	it("deletes a trashed account row and its CommandCode config entry, so projection cannot rebuild it", async () => {
		const { runtime, params } = createRuntime({ authDir: root });
		await runtime.addCommandCodeAccount("cc-managed-key", "Managed");
		const [account] = await runtime.listAccounts();
		expect(account?.key).toBe(commandCodeAccountFilename("cc-managed-key"));

		await runtime.trashAccount(account!.auth_index);
		expect(await runtime.listAccounts()).toEqual([]);
		expect(await runtime.listCommandCodeAccounts()).toHaveLength(1);

		await runtime.purgeAccount(account!.auth_index);
		expect(await runtime.listAccounts({ includeTrashed: true })).toEqual([]);
		expect(await runtime.listCommandCodeAccounts()).toEqual([]);
		expect(JSON.stringify(params.get("cliproxy_settings") ?? {})).not.toContain("cc-managed-key");

		// 再跑一次投影：来源已移除，账号不会被重建。
		await runtime.saveSettings(runtime.settings);
		expect(await runtime.listAccounts({ includeTrashed: true })).toEqual([]);
	});

	it("deletes a trashed saved key and its key record, and accepts the account key as the reference", async () => {
		const { runtime } = createRuntime({ authDir: root });
		await runtime.saveSubscriptionKey("opencode-go", undefined, "Round", "sk-round-trip");
		const [account] = await runtime.listAccounts();
		const key = account!.key;
		expect(key.startsWith("subscription-opencode-go-")).toBe(true);
		expect(await runtime.listSavedKeys("opencode-go")).toHaveLength(1);

		await runtime.trashAccount(key);
		await runtime.purgeAccount(key);
		expect(await runtime.listAccounts({ includeTrashed: true })).toEqual([]);
		expect(await runtime.listSavedKeys("opencode-go")).toEqual([]);

		// 投影不会再从已删除的 key 记录生成账号。
		await runtime.saveSettings(runtime.settings);
		expect(await runtime.listAccounts({ includeTrashed: true })).toEqual([]);
	});

	it("imports legacy auth files only once and keeps a purged account deleted across restarts", async () => {
		await writeFile(path.join(root, "codex-legacy.json"), JSON.stringify({ type: "codex", access_token: "legacy-token" }));
		const first = createRuntime({ authDir: root });
		await first.runtime.initialize();
		expect((await first.accounts.list("codex")).map((account) => account.key)).toEqual(["codex-legacy.json"]);
		expect(first.params.get(LEGACY_ACCOUNT_IMPORT_STATE_PARAM)).toMatchObject({ completed: true });
		first.runtime.shutdown();

		// 模拟重启后新增的旧文件：完成标记已落库，不再扫描目录。
		await writeFile(path.join(root, "codex-added-later.json"), JSON.stringify({ type: "codex", access_token: "legacy-token-2" }));
		const second = createRuntime({ authDir: root, params: first.params, accounts: first.accounts });
		await second.runtime.initialize();
		expect((await second.accounts.list()).map((account) => account.key)).toEqual(["codex-legacy.json"]);
		second.runtime.shutdown();
	});

	it("deletes the legacy cold backup when an account is purged and keeps it deleted after a restart", async () => {
		const first = createRuntime({ authDir: root });
		await first.runtime.initialize();
		await first.runtime.addCommandCodeAccount("cc-backup-key", "Backup");
		const [account] = await first.runtime.listAccounts();
		const key = account!.key;
		const trash = path.join(root, ".trash");
		await mkdir(trash, { recursive: true });
		await writeFile(path.join(root, key), "{}");
		await writeFile(path.join(trash, `1700000000000-${key}`), "{}");

		await first.runtime.trashAccount(account!.auth_index);
		await first.runtime.purgeAccount(account!.auth_index);
		await expect(readFile(path.join(root, key), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
		await expect(readFile(path.join(trash, `1700000000000-${key}`), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
		expect(await first.runtime.listAccounts({ includeTrashed: true })).toEqual([]);
		first.runtime.shutdown();

		const second = createRuntime({ authDir: root, params: first.params, accounts: first.accounts });
		await second.runtime.initialize();
		expect(await second.runtime.listAccounts({ includeTrashed: true })).toEqual([]);
		second.runtime.shutdown();
	});

	it("reports a missing account after it has been purged", async () => {
		const { runtime } = createRuntime({ authDir: root });
		await runtime.addCommandCodeAccount("cc-gone-key", "Gone");
		const [account] = await runtime.listAccounts();
		await runtime.trashAccount(account!.auth_index);
		await runtime.purgeAccount(account!.auth_index);
		await expect(runtime.purgeAccount(account!.auth_index)).rejects.toThrow("订阅账号不存在");
		await expect(runtime.restoreAccount(account!.auth_index)).rejects.toThrow("订阅账号不存在");
	});
});
