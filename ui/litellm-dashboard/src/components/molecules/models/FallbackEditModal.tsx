/**
 * 模型 Fallback 编辑弹窗（Models 表 Fallback 列）
 * 主模型固定为该行 model_name；fallback 模型多选（选项=全部 model_name，排除自身）。
 * 保存链路：GET /get/config/callbacks 取当前 router_settings → 合并替换 fallbacks 中
 * 该 model_group 条目（空选择=删除条目）→ POST /config/update（setCallbacksCall）。
 * 先取后合并是为了避免整段覆盖丢失 router_settings 其他键。
 */

import NotificationsManager from "@/components/molecules/notifications_manager";
import { getCallbacksCall, setCallbacksCall } from "@/components/networking";
import { Modal, Select, Typography } from "antd";
import React, { useEffect, useState } from "react";

const { Text } = Typography;

type FallbackEntry = { [modelName: string]: string[] };

interface FallbackEditModalProps {
	isOpen: boolean;
	/** 主模型（该行 model_name），固定展示不可编辑 */
	modelName: string | null;
	/** 当前 fallback 链（model_info.fallbacks），作为多选初始值 */
	currentFallbacks: string[];
	/** 全部可选 model_name（排除主模型自身） */
	availableModels: string[];
	accessToken: string | null;
	userID: string | null;
	userRole: string | null;
	onCancel: () => void;
	onSuccess: () => void;
}

const FallbackEditModal: React.FC<FallbackEditModalProps> = ({
	isOpen,
	modelName,
	currentFallbacks,
	availableModels,
	accessToken,
	userID,
	userRole,
	onCancel,
	onSuccess,
}) => {
	const [selectedFallbacks, setSelectedFallbacks] = useState<string[]>([]);
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		if (isOpen) {
			setSelectedFallbacks(currentFallbacks);
		}
	}, [isOpen, currentFallbacks]);

	const handleSave = async () => {
		if (!accessToken || !userID || !userRole || !modelName) {
			return;
		}
		setSaving(true);
		try {
			// 保存时取最新 router_settings 作为合并基座，避免整段覆盖丢键
			const data = await getCallbacksCall(accessToken, userID, userRole);
			const routerSettings = { ...data.router_settings };
			delete routerSettings["model_group_retry_policy"];
			const existing: FallbackEntry[] = Array.isArray(routerSettings.fallbacks) ? routerSettings.fallbacks : [];

			let replaced = false;
			const merged = existing
				.map((dict) => {
					const next = { ...dict };
					if (modelName in next) {
						replaced = true;
						if (selectedFallbacks.length > 0) {
							next[modelName] = selectedFallbacks;
						} else {
							delete next[modelName];
						}
					}
					return next;
				})
				.filter((dict) => Object.keys(dict).length > 0);
			if (!replaced && selectedFallbacks.length > 0) {
				merged.push({ [modelName]: selectedFallbacks });
			}

			await setCallbacksCall(accessToken, {
				router_settings: { ...routerSettings, fallbacks: merged },
			});
			NotificationsManager.success("Fallbacks updated successfully");
			onSuccess();
		} catch (error) {
			NotificationsManager.fromBackend("Failed to update fallbacks: " + error);
		} finally {
			setSaving(false);
		}
	};

	const options = availableModels.filter((name) => name !== modelName).map((name) => ({ value: name, label: name }));

	return (
		<Modal
			title="Edit Fallbacks"
			open={isOpen}
			onCancel={onCancel}
			onOk={handleSave}
			confirmLoading={saving}
			okText="Save"
			destroyOnClose
		>
			<div className="flex flex-col gap-4 mt-2">
				<div>
					<Text type="secondary" style={{ fontSize: 12 }}>
						Model
					</Text>
					<div>
						<Text strong>{modelName ?? "-"}</Text>
					</div>
				</div>
				<div>
					<Text type="secondary" style={{ fontSize: 12 }}>
						Fallback Models
					</Text>
					<Select
						mode="multiple"
						style={{ width: "100%" }}
						placeholder="Select fallback models"
						value={selectedFallbacks}
						onChange={setSelectedFallbacks}
						options={options}
						showSearch
					/>
				</div>
				<Text type="secondary" style={{ fontSize: 12 }}>
					When this model fails, the proxy retries the selected fallbacks in order. Leave empty to remove the fallback
					entry for this model.
				</Text>
			</div>
		</Modal>
	);
};

export default FallbackEditModal;
