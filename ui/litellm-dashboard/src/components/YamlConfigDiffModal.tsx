import React, { useState } from "react";
import { Modal, Table, Button, Tag, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { YamlConfigDiffItem } from "./networking";

interface YamlConfigDiffModalProps {
	isOpen: boolean;
	items: YamlConfigDiffItem[];
	onAccept: (section: string, key: string) => Promise<void>;
	onResolve: () => Promise<void>;
	onClose: () => void;
}

/** 差异类型中文标签 */
const DIFF_KIND_LABELS: Record<string, { label: string; color: string }> = {
	db_missing: { label: "DB 缺失", color: "orange" },
	value_differs: { label: "值不同", color: "red" },
	params_differ: { label: "参数不同", color: "red" },
};

/** 值展示：JSON.stringify 截断，避免长配置撑爆表格 */
const VALUE_DISPLAY_MAX_LENGTH = 120;

function formatDiffValue(value: unknown): string {
	if (value === null || value === undefined) return "—";
	let text: string;
	try {
		text = JSON.stringify(value);
	} catch {
		text = String(value);
	}
	if (text.length > VALUE_DISPLAY_MAX_LENGTH) {
		return `${text.slice(0, VALUE_DISPLAY_MAX_LENGTH)}…`;
	}
	return text;
}

/**
 * yaml 差异对比导入窗口：启动检测到 yaml 与 DB 配置不一致时弹出，
 * 逐项「接受」将 yaml 值覆盖至 DB，全部处理完点「处理冲突完成」存快照。
 */
export default function YamlConfigDiffModal({ isOpen, items, onAccept, onResolve, onClose }: YamlConfigDiffModalProps) {
	const [acceptingKey, setAcceptingKey] = useState<string | null>(null);
	const [resolving, setResolving] = useState(false);

	const handleAccept = async (record: YamlConfigDiffItem) => {
		const rowKey = `${record.section}:${record.key}`;
		setAcceptingKey(rowKey);
		try {
			await onAccept(record.section, record.key);
		} catch (error) {
			message.error(`接受失败: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			setAcceptingKey(null);
		}
	};

	const handleResolve = async () => {
		setResolving(true);
		try {
			await onResolve();
		} catch (error) {
			message.error(`操作失败: ${error instanceof Error ? error.message : String(error)}`);
		} finally {
			setResolving(false);
		}
	};

	const columns: ColumnsType<YamlConfigDiffItem> = [
		{ title: "段", dataIndex: "section", key: "section", width: 160 },
		{ title: "键", dataIndex: "key", key: "key", width: 180 },
		{
			title: "差异类型",
			dataIndex: "diff_kind",
			key: "diff_kind",
			width: 110,
			render: (kind: string) => {
				const meta = DIFF_KIND_LABELS[kind] ?? { label: kind, color: "default" };
				return <Tag color={meta.color}>{meta.label}</Tag>;
			},
		},
		{
			title: "yaml 值",
			dataIndex: "yaml_value",
			key: "yaml_value",
			render: (value: unknown) => <code style={{ wordBreak: "break-all" }}>{formatDiffValue(value)}</code>,
		},
		{
			title: "DB 值",
			dataIndex: "db_value",
			key: "db_value",
			render: (value: unknown) => <code style={{ wordBreak: "break-all" }}>{formatDiffValue(value)}</code>,
		},
		{
			title: "操作",
			key: "action",
			width: 90,
			render: (_: unknown, record: YamlConfigDiffItem) => (
				<Button
					size="small"
					loading={acceptingKey === `${record.section}:${record.key}`}
					onClick={() => handleAccept(record)}
				>
					接受
				</Button>
			),
		},
	];

	return (
		<Modal
			title="检测到 yaml 配置与数据库不一致"
			open={isOpen}
			onCancel={onClose}
			width={1100}
			footer={[
				<Button key="resolve" type="primary" loading={resolving} onClick={handleResolve}>
					处理冲突完成
				</Button>,
			]}
		>
			<p style={{ marginBottom: 12 }}>
				启动时检测到 yaml 配置文件与数据库中的设置存在以下差异。逐项点击「接受」可将 yaml 值覆盖到数据库并立即生效；
				处理完成后点击「处理冲突完成」保存当前 yaml 快照。
			</p>
			<Table<YamlConfigDiffItem>
				rowKey={(record) => `${record.section}:${record.key}`}
				columns={columns}
				dataSource={items}
				pagination={false}
				size="small"
				scroll={{ y: 400 }}
			/>
		</Modal>
	);
}
