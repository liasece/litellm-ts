import { requestJson } from "../../platform/api/HttpApiClient";
export async function saveByokCredential(serverId: string, credential: string, save: boolean) {
	return requestJson<unknown>("/v1/mcp/server/" + encodeURIComponent(serverId) + "/user-credential", {
		method: "POST",
		body: JSON.stringify({ credential: credential.trim(), save }),
	});
}
