import type { AccessRecord, AccessTeam } from "../support/AccessModels";
import type { CsvUserRow } from "../support/CsvUserModels";
export function parseCsv(text: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [],
		field = "",
		quoted = false;
	for (let index = 0; index < text.length; index++) {
		const char = text[index];
		if (char === '"') {
			if (quoted && text[index + 1] === '"') {
				field += '"';
				index++;
			} else if (!field || quoted) quoted = !quoted;
			else field += char;
		} else if (char === "," && !quoted) {
			row.push(field);
			field = "";
		} else if ((char === "\n" || char === "\r") && !quoted) {
			if (char === "\r" && text[index + 1] === "\n") index++;
			row.push(field);
			rows.push(row);
			row = [];
			field = "";
		} else field += char;
	}
	if (quoted) throw new Error("Unterminated quoted field");
	row.push(field);
	rows.push(row);
	if (rows[0]?.[0]) rows[0][0] = rows[0][0].replace(/^\uFEFF/, "");
	return rows;
}
export function parseCsvUsers(text: string, teams: AccessTeam[]): { rows: CsvUserRow[]; error: string; structureError: string } {
	const data = parseCsv(text),
		header = data[0] ?? [];
	if (!text) return { rows: [], error: "", structureError: "The CSV file appears to be empty. Please upload a file with data." };
	if (data.length === 1)
		return {
			rows: [],
			error: "",
			structureError: "The CSV file only contains headers but no user data. Please add user data to your CSV.",
		};
	const missing = ["user_email", "user_role"].filter((name) => !header.includes(name));
	if (missing.length)
		return {
			rows: [],
			error: "",
			structureError:
				"Your CSV is missing these required columns: " + missing.join(", ") + ". Please add these columns to your CSV file.",
		};
	const rows: CsvUserRow[] = [];
	for (const [index, row] of data.slice(1).entries()) {
		if (row.length === 1 && row[0] === "") continue;
		const read = (name: string) => row[header.indexOf(name)]?.trim() ?? "";
		const user: CsvUserRow = {
			user_email: read("user_email"),
			user_role: read("user_role"),
			teams: read("teams"),
			models: read("models"),
			max_budget: read("max_budget"),
			budget_duration: read("budget_duration"),
			rowNumber: index + 2,
			isValid: true,
			error: "",
		};
		if (row.length < header.length) {
			user.user_email = "";
			user.user_role = "";
			user.isValid = false;
			user.error = "Row " + (index + 2) + " has fewer columns than the header row. Please ensure all data is properly formatted.";
			rows.push(user);
			continue;
		}
		const errors: string[] = [];
		if (!user.user_email) errors.push("Email is required");
		else if (!user.user_email.includes("@") || !user.user_email.includes("."))
			errors.push("Invalid email format (must contain @ and domain)");
		const roles = ["proxy_admin", "proxy_admin_viewer", "internal_user", "internal_user_viewer"];
		if (!user.user_role) errors.push("Role is required");
		else if (!roles.includes(user.user_role)) errors.push('Invalid role "' + user.user_role + '". Must be one of: ' + roles.join(", "));
		if (user.max_budget) {
			const budget = parseFloat(user.max_budget);
			if (Number.isNaN(budget)) errors.push('Max budget "' + user.max_budget + '" must be a number');
			else if (budget <= 0) errors.push("Max budget must be greater than 0");
		}
		if (user.budget_duration && !/^\d+[dhmwy]$|^\d+mo$/.test(user.budget_duration))
			errors.push('Invalid budget duration format "' + user.budget_duration + '". Use format like "30d", "1mo", "2w", "6h"');
		if (user.teams && teams.length) {
			const invalid = user.teams
				.split(",")
				.map((value) => value.trim())
				.filter((id) => !teams.some((team) => team.team_id === id));
			if (invalid.length) errors.push("Unknown team(s): " + invalid.join(", "));
		}
		user.isValid = errors.length === 0;
		user.error = errors.join(", ");
		rows.push(user);
	}
	const valid = rows.filter((row) => row.isValid);
	return {
		rows,
		structureError: rows.length ? "" : "No valid data rows found in the CSV file. Please check your file format.",
		error:
			!valid.length && rows.length
				? "No valid users found in the CSV. Please check the errors below and fix your CSV file."
				: valid.length < rows.length
					? "Found " +
						(rows.length - valid.length) +
						" row(s) with errors out of " +
						rows.length +
						" total rows. Please correct them before proceeding."
					: "",
	};
}
export function csvUserPayload(row: CsvUserRow): AccessRecord {
	const value: AccessRecord = { user_email: row.user_email, user_role: row.user_role };
	for (const name of ["teams", "models"] as const)
		if (row[name]?.trim()) {
			const items = row[name]
				.split(",")
				.map((value) => value.trim())
				.filter(Boolean);
			if (items.length) value[name] = items;
		}
	if (row.max_budget && parseFloat(row.max_budget) > 0) value.max_budget = parseFloat(row.max_budget);
	if (row.budget_duration?.trim()) value.budget_duration = row.budget_duration.trim();
	if (row.metadata?.trim()) value.metadata = row.metadata.trim();
	return value;
}
export function encodeCsv(rows: unknown[][]): string {
	return rows
		.map((row) =>
			row
				.map((value) => {
					const text = String(value ?? "");
					return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
				})
				.join(","),
		)
		.join("\r\n");
}
