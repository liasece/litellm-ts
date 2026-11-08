import { reactive } from "vue";
import { accessApi, type AccessApi } from "../api/AccessApi";
import { objectValue } from "../logic/ResourceDraftLogic";
import { csvUserPayload, encodeCsv, parseCsvUsers } from "../logic/CsvUsersLogic";
import type { CsvUserRow } from "../support/CsvUserModels";
import type { AccessTeam } from "../support/AccessModels";
export function createCsvUsersStore(
	teams: () => AccessTeam[],
	sso: () => boolean,
	onChanged: () => void | Promise<void>,
	api: AccessApi = accessApi,
) {
	const state = reactive({
		rows: [] as CsvUserRow[],
		fileName: "",
		fileSize: 0,
		fileError: "",
		structureError: "",
		parseError: "",
		processing: false,
		page: 1,
	});
	let generation = 0,
		disposed = false;
	async function upload(file: File) {
		const current = ++generation;
		state.fileName = file.name;
		state.fileSize = file.size;
		state.rows = [];
		state.fileError = "";
		state.structureError = "";
		state.parseError = "";
		state.page = 1;
		if (file.type !== "text/csv" && !file.name.endsWith(".csv")) {
			state.fileError = "Invalid file type: " + file.name + ". Please upload a CSV file (.csv extension).";
			return;
		}
		if (file.size > 5 * 1024 * 1024) {
			state.fileError =
				"File is too large (" + (file.size / (1024 * 1024)).toFixed(1) + " MB). Please upload a CSV file smaller than 5MB.";
			return;
		}
		try {
			const result = parseCsvUsers(await file.text(), teams());
			if (current === generation && !disposed) {
				state.rows = result.rows;
				state.structureError = result.structureError;
				state.parseError = result.error;
			}
		} catch (reason) {
			if (current === generation && !disposed)
				state.parseError = "Error parsing CSV: " + (reason instanceof Error ? reason.message : "Unknown error");
		}
	}
	function clear() {
		++generation;
		state.fileName = "";
		state.fileSize = 0;
		state.rows = [];
		state.fileError = "";
		state.structureError = "";
		state.parseError = "";
		state.page = 1;
	}
	async function create() {
		if (state.processing) return;
		state.processing = true;
		state.rows = state.rows.map((row) => ({ ...row, status: "pending" }));
		let successful = false;
		for (let index = 0; index < state.rows.length; index++) {
			if (disposed) break;
			const row = state.rows[index];
			try {
				const response = objectValue(await api.createUser(csvUserPayload(row)));
				if (!response.key && !response.user_id) {
					row.status = "failed";
					row.error = String(response.error ?? "Failed to create user");
					continue;
				}
				successful = true;
				const id = String(objectValue(response.data).user_id ?? response.user_id),
					origin = new URL("/", window.location.href).toString();
				row.status = "success";
				row.key = String(response.key ?? response.user_id);
				try {
					row.invitation_link = sso()
						? new URL("/ui", origin).toString()
						: new URL("/ui?invitation_id=" + (await api.invite(id)).id, origin).toString();
				} catch {
					row.error = "User created but failed to generate invitation link";
				}
			} catch (reason) {
				row.status = "failed";
				row.error = reason instanceof Error ? reason.message : String(reason);
			}
		}
		state.processing = false;
		if (successful) await onChanged();
	}
	function template() {
		return encodeCsv([
			["user_email", "user_role", "teams", "max_budget", "budget_duration", "models"],
			["user@example.com", "internal_user", "team-id-1,team-id-2", "100", "30d", "gpt-3.5-turbo,gpt-4"],
		]);
	}
	function results() {
		return encodeCsv([
			["user_email", "user_role", "status", "key", "invitation_link", "error"],
			...state.rows.map((row) => [row.user_email, row.user_role, row.status, row.key, row.invitation_link, row.error]),
		]);
	}
	function dispose() {
		disposed = true;
		++generation;
	}
	return { state, upload, clear, create, template, results, dispose };
}
