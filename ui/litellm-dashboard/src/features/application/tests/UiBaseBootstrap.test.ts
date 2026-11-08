import fs from "node:fs";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
const script = fs.readFileSync(new URL("../../../../public/ui-base.js", import.meta.url), "utf8");
describe("UI asset base bootstrap", () => {
	it.each(["/ui/", "/ui/login", "/ui/mcp/oauth/callback", "/tenant/ui/settings/router-settings", "/tenant/ui/extra/ui/login"])(
		"keeps assets on the same origin and installation for %s",
		(pathname) => {
			const nodes: { href?: string }[] = [];
			vm.runInNewContext(script, {
				window: { location: { pathname, origin: "https://proxy.example.test" } },
				document: {
					querySelector: () => null,
					createElement: (name: string) => {
						expect(name).toBe("base");
						return {};
					},
					head: { prepend: (node: { href?: string }) => nodes.push(node) },
				},
			});
			const expected = pathname.slice(0, pathname.lastIndexOf("/ui") + 3) + "/";
			expect(nodes).toEqual([{ href: "https://proxy.example.test" + expected }]);
		},
	);
	it("never interprets repeated leading slashes as an external origin", () => {
		let href = "";
		vm.runInNewContext(script, {
			window: { location: { pathname: "//attacker.example/ui/login", origin: "https://proxy.example.test" } },
			document: {
				querySelector: () => null,
				createElement: () => ({}),
				head: { prepend: (base: { href: string }) => (href = base.href) },
			},
		});
		expect(new URL(href).origin).toBe("https://proxy.example.test");
	});
	it("freezes the server-provided relative base without adding a second element", () => {
		const base = { href: "../", isConnected: true };
		let appended = false;
		vm.runInNewContext(script, {
			window: { location: { pathname: "/tenant/ui/settings/router-settings", origin: "https://proxy.example.test" } },
			document: {
				querySelector: () => base,
				createElement: () => {
					throw new Error("Unexpected duplicate base");
				},
				head: {
					prepend: () => {
						appended = true;
					},
				},
			},
		});
		expect(base.href).toBe("https://proxy.example.test/tenant/ui/");
		expect(appended).toBe(false);
	});
});
