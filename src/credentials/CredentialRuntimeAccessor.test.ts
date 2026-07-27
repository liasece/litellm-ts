import { CredentialRuntimeAccessor } from "./CredentialRuntimeAccessor";

const openAiCredential = {
	credential_name: "openai",
	credential_values: { api_key: "sk-secret" },
	credential_info: { description: "prod" },
};

describe("CredentialRuntimeAccessor", () => {
	it("replaceAll/upsert/remove 管理实例 Map，所有读取均返回副本", () => {
		const accessor = new CredentialRuntimeAccessor();
		accessor.replaceAll([openAiCredential]);

		const credential = accessor.get("openai");
		const values = accessor.getValues("openai");
		expect(credential).toEqual(openAiCredential);
		expect(values).toEqual({ api_key: "sk-secret" });
		credential!.credential_values.api_key = "mutated";
		values!.api_key = "mutated";
		expect(accessor.get("openai")).toEqual(openAiCredential);

		accessor.upsert({ ...openAiCredential, credential_values: { api_key: "sk-next" } });
		expect(accessor.getValues("openai")).toEqual({ api_key: "sk-next" });
		accessor.remove("openai");
		expect(accessor.get("openai")).toBeUndefined();
		expect(accessor.getValues("openai")).toBeUndefined();
	});
});
