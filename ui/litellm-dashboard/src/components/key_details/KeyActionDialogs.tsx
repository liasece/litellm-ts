import { useMoneyFormatter } from "@/contexts/PriceDisplay";
import { Money } from "@/contexts/PriceDisplay";
import { Modal } from "antd";
import DeleteResourceModal from "../common_components/DeleteResourceModal";
import type { KeyResponse } from "../key_team_helpers/key_list";
import { RegenerateKeyModal } from "../organisms/regenerate_key_modal";
import { KeyEditView } from "../templates/key_edit_view";

interface KeyActionDialogsProps {
	keyData: KeyResponse;
	teams: any[] | null;
	accessToken: string | null;
	userId: string | null;
	userRole: string | null;
	premiumUser: boolean;
	editing: boolean;
	regenerateOpen: boolean;
	deleteOpen: boolean;
	deleteLoading: boolean;
	resetSpendOpen: boolean;
	resetSpendLoading: boolean;
	onEditClose: () => void;
	onEditSubmit: (values: Record<string, any>) => Promise<void>;
	onRegenerateClose: () => void;
	onRegenerateUpdate: (keyData: Partial<KeyResponse>) => void;
	onDeleteClose: () => void;
	onDeleteConfirm: () => void;
	onResetSpendClose: () => void;
	onResetSpendConfirm: () => void;
}

export default function KeyActionDialogs(props: KeyActionDialogsProps) {
	const formatMoney = useMoneyFormatter();
	return (
		<>
			<RegenerateKeyModal
				selectedToken={props.keyData}
				visible={props.regenerateOpen}
				onClose={props.onRegenerateClose}
				onKeyUpdate={props.onRegenerateUpdate}
			/>

			<DeleteResourceModal
				isOpen={props.deleteOpen}
				title="Delete Key"
				alertMessage="This action is irreversible and will immediately revoke access for any applications using this key."
				message="Are you sure you want to delete this Virtual Key?"
				resourceInformationTitle="Key Information"
				resourceInformation={[
					{ label: "Key Alias", value: props.keyData.key_alias || "-" },
					{ label: "Key ID", value: props.keyData.token_id || props.keyData.token || "-", code: true },
					{ label: "Team ID", value: props.keyData.team_id || "-", code: true },
					{
						label: "Spend",
						value: props.keyData.spend ? formatMoney(props.keyData.spend, 4) : formatMoney(0, 4),
					},
				]}
				onCancel={props.onDeleteClose}
				onOk={props.onDeleteConfirm}
				confirmLoading={props.deleteLoading}
				requiredConfirmation={props.keyData.key_alias}
			/>

			<Modal
				title="Reset Key Spend"
				open={props.resetSpendOpen}
				onOk={props.onResetSpendConfirm}
				onCancel={props.onResetSpendClose}
				okText="Reset"
				okButtonProps={{ danger: true }}
				confirmLoading={props.resetSpendLoading}
			>
				<p>
					Reset spend for <strong>{props.keyData.key_alias || props.keyData.token_id || "this key"}</strong> to{" "}
					<strong>{<Money value={0} decimals={0} />}</strong>?
				</p>
				<p className="mt-2 text-sm text-gray-500">
					Current spend: <strong>{<Money value={props.keyData.spend} decimals={4} />}</strong>. Spend history is
					preserved in logs. This resets the current period spend counter, the same as an automatic budget reset.
				</p>
			</Modal>

			<Modal
				title="Edit Virtual Key"
				open={props.editing}
				footer={null}
				destroyOnHidden
				width="min(960px, 100vw)"
				onCancel={props.onEditClose}
			>
				<KeyEditView
					keyData={props.keyData}
					onCancel={props.onEditClose}
					onSubmit={props.onEditSubmit}
					teams={props.teams}
					accessToken={props.accessToken}
					userID={props.userId}
					userRole={props.userRole}
					premiumUser={props.premiumUser}
				/>
			</Modal>
		</>
	);
}
