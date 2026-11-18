import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { SubscriptionAccountStore } from "./accountStore";

let root: string;

beforeEach(async () => {
	root = await mkdtemp(path.join(os.tmpdir(), "subscription-account-store-"));
});

afterEach(async () => {
	await rm(root, { recursive: true, force: true });
});

it("persists a registered display email on a key account and removes it when cleared", async () => {
	const store = new SubscriptionAccountStore({ authDir: root });
	const target = path.join(root, "Personal.json");
	await writeFile(target, JSON.stringify({ type: "opencode-go", api_key: "fixture-open-code-key", label: "Personal" }));
	expect((await store.list("opencode-go"))[0]?.email).toBeUndefined();

	await store.setEmail("Personal.json", "owner@example.com");
	expect((await store.list("opencode-go"))[0]?.email).toBe("owner@example.com");
	expect(JSON.parse(await readFile(target, "utf8"))).toMatchObject({
		type: "opencode-go",
		api_key: "fixture-open-code-key",
		label: "Personal",
		email: "owner@example.com",
	});

	await store.setEmail("Personal.json", null);
	expect((await store.list("opencode-go"))[0]?.email).toBeUndefined();
	expect(JSON.parse(await readFile(target, "utf8"))).not.toHaveProperty("email");
});
