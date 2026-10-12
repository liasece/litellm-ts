import { validateKeyAlias } from "./KeyAliasPolicy";

describe("key alias naming policy", () => {
	it("applies the entire configured regex when a naming policy is enabled", () => {
		expect(() => validateKeyAlias("finance-001", { key_alias_pattern: "finance-[0-9]+" })).not.toThrow();
		for (const alias of ["Xfinance-001", "finance-001X", "../finance", "finance/001", "bad\nname"])
			expect(() => validateKeyAlias(alias, { key_alias_pattern: "finance-[0-9]+" })).toThrow();
	});
});

it("keeps legacy display aliases valid until a naming policy is explicitly enabled", () => {
	for (const alias of ["team/project", "release..archive", "名称 / 描述"]) expect(() => validateKeyAlias(alias, {})).not.toThrow();
	expect(() => validateKeyAlias("team/project", { enable_key_alias_format_validation: true })).toThrow();
});
