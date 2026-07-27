import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { CredentialItem } from "../networking";
import ReuseCredentialsModal from "./reuse_credentials";

const credential: CredentialItem = {
	credential_name: "shared-openai",
	credential_values: {
		api_key: "****last",
		api_base: "https://api.example.com",
	},
	credential_info: {
		custom_llm_provider: "openai",
	},
};

describe("ReuseCredentialsModal", () => {
	it("shows only safe metadata and submits only the credential name", async () => {
		const onAddCredential = vi.fn();

		render(
			<ReuseCredentialsModal
				isVisible={true}
				onCancel={vi.fn()}
				onAddCredential={onAddCredential}
				existingCredential={credential}
				setIsCredentialModalOpen={vi.fn()}
			/>,
		);

		expect(screen.getByText("shared-openai")).toBeInTheDocument();
		expect(screen.getByText("openai")).toBeInTheDocument();
		expect(screen.getByText("api_key")).toBeInTheDocument();
		expect(screen.getByText("api_base")).toBeInTheDocument();
		expect(screen.queryByDisplayValue("****last")).not.toBeInTheDocument();
		expect(screen.queryByRole("textbox", { name: "api_key" })).not.toBeInTheDocument();

		const credentialName = screen.getByRole("textbox", { name: "New Credential Name" });
		fireEvent.change(credentialName, { target: { value: "  copied-openai  " } });
		fireEvent.click(screen.getByRole("button", { name: "Reuse Credentials" }));
		await waitFor(() => expect(onAddCredential).toHaveBeenCalledWith({ credential_name: "copied-openai" }));
	});

	it("rejects a blank new credential name without sending credential data", async () => {
		const onAddCredential = vi.fn();
		render(
			<ReuseCredentialsModal
				isVisible={true}
				onCancel={vi.fn()}
				onAddCredential={onAddCredential}
				existingCredential={credential}
				setIsCredentialModalOpen={vi.fn()}
			/>,
		);

		fireEvent.change(screen.getByRole("textbox", { name: "New Credential Name" }), { target: { value: "   " } });
		fireEvent.click(screen.getByRole("button", { name: "Reuse Credentials" }));
		await waitFor(() => expect(screen.getAllByText("Enter a credential name").length).toBeGreaterThan(0));
		expect(onAddCredential).not.toHaveBeenCalled();
	});
});
