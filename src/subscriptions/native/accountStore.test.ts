import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SubscriptionAccountStore } from "./accountStore";
import { MemorySubscriptionAccountPersistence } from "./accountPersistence";

let root: string;

beforeEach(async () => {
	root = await mkdtemp(path.join(os.tmpdir(), "subscription-account-store-"));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

it("persists a registered display email on a key account and removes it when cleared", async () => {
	const store = new SubscriptionAccountStore({ authDir: root });
	await store.writeRaw("Personal.json", { type: "opencode-go", api_key: "fixture-open-code-key", label: "Personal" });
	expect((await store.list("opencode-go"))[0]?.email).toBeUndefined();

	await store.setEmail("Personal.json", "owner@example.com");
	expect((await store.list("opencode-go"))[0]?.email).toBe("owner@example.com");
	expect(await store.readRaw("Personal.json")).toMatchObject({
		type: "opencode-go",
		api_key: "fixture-open-code-key",
		label: "Personal",
		email: "owner@example.com",
	});

	await store.setEmail("Personal.json", null);
	expect((await store.list("opencode-go"))[0]?.email).toBeUndefined();
	expect(await store.readRaw("Personal.json")).not.toHaveProperty("email");
});

it("imports the legacy auth directory and .trash once, keeping the trashed state", async () => {
	await writeFile(path.join(root, "codex-live.json"), JSON.stringify({ type: "codex", access_token: "old-access" }));
	await writeFile(path.join(root, "broken.json"), "{");
	await writeFile(path.join(root, "unknown.json"), JSON.stringify({ hello: "world" }));
	const trash = path.join(root, ".trash");
	await mkdir(trash, { recursive: true });
	await writeFile(path.join(trash, "1700000000000-codex-old.json"), JSON.stringify({ type: "codex", access_token: "old-refresh" }));

	const store = new SubscriptionAccountStore({ authDir: root });
	const first = await store.importLegacyFiles();
	expect(first).toMatchObject({ imported: 1, trashed: 1 });
	expect((await store.list("codex")).map((account) => account.key)).toEqual(["codex-live.json"]);
	expect((await store.listTrashed("codex")).map((account) => account.key)).toEqual(["codex-old.json"]);
	expect((await store.listTrashed())[0]?.trashedAt).toBe(new Date(1_700_000_000_000).toISOString());

	// 再跑一次不会重复导入：有效性由数据库字段决定，与磁盘文件是否还在无关。
	expect(await store.importLegacyFiles()).toMatchObject({ imported: 0, trashed: 0 });

	// 文件保留在磁盘作为冷备份。
	expect(JSON.parse(await readFile(path.join(root, "codex-live.json"), "utf8"))).toHaveProperty("access_token");
});

it("same key in the auth directory and .trash imports as trashed: revocation wins over a resurrected file", async () => {
	// 旧实现的设置保存会把已回收的 key 投影回有效文件，于是同名文件两边都有。
	await writeFile(
		path.join(root, "subscription-opencode-go-1.json"),
		JSON.stringify({ type: "opencode-go", api_key: "fixture-open-code-key" }),
	);
	const trash = path.join(root, ".trash");
	await mkdir(trash, { recursive: true });
	await writeFile(
		path.join(trash, "1700000000000-subscription-opencode-go-1.json"),
		JSON.stringify({ type: "opencode-go", api_key: "fixture-open-code-key", label: "old" }),
	);

	const store = new SubscriptionAccountStore({ authDir: root });
	expect(await store.importLegacyFiles()).toMatchObject({ imported: 0, trashed: 1 });
	expect(await store.findByKey("subscription-opencode-go-1.json")).toBeUndefined();
	const trashed = await store.listTrashed();
	expect(trashed.map((account) => account.key)).toEqual(["subscription-opencode-go-1.json"]);
	expect(trashed[0]?.trashedAt).toBe(new Date(1_700_000_000_000).toISOString());
	// 正文取较新的有效文件（label 是当前值），不被回收站旧副本覆盖。
	expect(trashed[0]?.raw["label"]).toBeUndefined();
});

it("deletes every legacy cold backup of a purged account so it cannot be re-imported", async () => {
	const key = "subscription-opencode-go-purged.json";
	const trash = path.join(root, ".trash");
	await mkdir(trash, { recursive: true });
	await writeFile(path.join(root, key), JSON.stringify({ type: "opencode-go", api_key: "fixture-purged-key" }));
	await writeFile(path.join(trash, `1700000000000-${key}`), JSON.stringify({ type: "opencode-go", api_key: "fixture-purged-key" }));
	await writeFile(path.join(trash, `1700000001000-other.json`), JSON.stringify({ type: "opencode-go", api_key: "fixture-other-key" }));

	const store = new SubscriptionAccountStore({ authDir: root });
	await store.removeLegacyBackups(key);

	await expect(readFile(path.join(root, key), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
	await expect(readFile(path.join(trash, `1700000000000-${key}`), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
	expect(JSON.parse(await readFile(path.join(trash, "1700000001000-other.json"), "utf8"))).toHaveProperty("api_key");
});

it("trashes by database state and keeps a trashed key out of the active list", async () => {
	const store = new SubscriptionAccountStore({ authDir: root });
	await store.writeRaw("codex-a.json", { type: "codex", access_token: "{{SECRET_aa11bb22}}" });
	const account = await store.findByKey("codex-a.json");
	expect(account).toBeDefined();

	await store.archive(account!.id);
	expect(await store.findByKey("codex-a.json")).toBeUndefined();
	expect((await store.listTrashed()).map((row) => row.key)).toEqual(["codex-a.json"]);

	// 已回收的账号键再次被写入（托管账号投影等）：只换正文，不改变有效性。
	await store.writeRaw("codex-a.json", { type: "codex", access_token: "{{SECRET_cc33dd44}}" });
	expect(await store.findByKey("codex-a.json")).toBeUndefined();
	expect((await store.readRaw(account!.id)).access_token).toBe("{{SECRET_cc33dd44}}");
	expect(await store.listTrashed()).toHaveLength(1);
});

it("refuses to restore a row whose key is already active", async () => {
	const trashed = new Date();
	const store = new SubscriptionAccountStore({
		authDir: root,
		persistence: new MemorySubscriptionAccountPersistence([
			{ id: "active-1", source: "codex", key: "codex-a.json", payload: { type: "codex" } },
			{ id: "trashed-1", source: "codex", key: "codex-a.json", payload: { type: "codex" }, trashedAt: trashed },
		]),
	});
	await expect(store.restore("trashed-1")).rejects.toThrow("同名订阅账号已存在，无法恢复");
});

it("restores the trashed row in place when the key is free", async () => {
	const store = new SubscriptionAccountStore({ authDir: root });
	await store.writeRaw("codex-b.json", { type: "codex", access_token: "{{SECRET_aa11bb22}}" });
	const account = await store.findByKey("codex-b.json");
	await store.archive(account!.id);
	await store.restore(account!.id);
	expect((await store.findByKey("codex-b.json"))?.id).toBe(account!.id);
	expect(await store.listTrashed()).toEqual([]);
});

it("serializes concurrent read-modify-write on one account", async () => {
	const store = new SubscriptionAccountStore({ authDir: root });
	await store.writeRaw("codex-c.json", { type: "codex", access_token: "{{SECRET_aa11bb22}}", counter: 0 });
	const order: string[] = [];
	await Promise.all(
		Array.from({ length: 5 }, async (_unused, index) =>
			store.withAccountLock("codex-c.json", 1_000, async () => {
				const raw = await store.readRaw("codex-c.json");
				await new Promise((resolve) => setTimeout(resolve, 5));
				order.push(String(index));
				await store.writeRaw("codex-c.json", { ...raw, counter: Number(raw["counter"]) + 1 });
			}),
		),
	);
	expect((await store.readRaw("codex-c.json"))["counter"]).toBe(5);
	expect(order).toHaveLength(5);
});

it("rejects unsafe account keys", async () => {
	const store = new SubscriptionAccountStore({ authDir: root });
	await expect(store.writeRaw("../escape.json", { type: "codex" })).rejects.toThrow("订阅账号键无效");
	await expect(store.writeRaw("no-suffix", { type: "codex" })).rejects.toThrow("订阅账号键无效");
	await expect(store.writeRaw("x.json", { type: "unknown-provider" })).rejects.toThrow("订阅账号来源无法识别");
});
