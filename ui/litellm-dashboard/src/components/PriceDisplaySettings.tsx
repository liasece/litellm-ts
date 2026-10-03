"use client";

import { useState } from "react";
import { Alert, Button, Input, Select, Space, Typography } from "antd";
import { useQueryClient } from "@tanstack/react-query";
import { fetchExchangeRates, savePriceDisplaySettings, usePriceDisplay } from "@/contexts/PriceDisplay";
import { DEFAULT_RATE_SOURCE } from "@/utils/priceDisplay";

export function CurrencySelect({
	value,
	onChange,
	followSystem = false,
}: {
	value: string;
	onChange: (value: string) => void;
	followSystem?: boolean;
}) {
	const { settings, exchange } = usePriceDisplay();
	const currencies = Array.from(
		new Set([
			"USD",
			"CNY",
			"EUR",
			"GBP",
			"JPY",
			"HKD",
			"SGD",
			...Object.keys(exchange?.rates ?? {}),
			value,
			settings.currency,
		]),
	)
		.filter(Boolean)
		.sort();
	return (
		<Select
			aria-label="价格显示币种"
			showSearch
			value={value}
			onChange={onChange}
			style={{ minWidth: 170 }}
			options={[
				...(followSystem ? [{ value: "", label: "跟随系统" }] : []),
				...currencies.map((currency) => ({ value: currency, label: currency })),
			]}
		/>
	);
}
export function ModelCurrencySetting({ modelId, modelName }: { modelId: string; modelName?: string }) {
	const { settings } = usePriceDisplay();
	const [error, setError] = useState("");
	return (
		<div className="px-3 py-3 border-t border-gray-100">
			<Space wrap>
				<span>价格显示币种</span>
				<CurrencySelect
					followSystem
					value={settings.modelCurrencies[modelId] ?? ""}
					onChange={(currency) => {
						const modelCurrencies = { ...settings.modelCurrencies };
						for (const key of [modelId, modelName].filter((key): key is string => !!key)) {
							if (currency) modelCurrencies[key] = currency;
							else delete modelCurrencies[key];
						}
						try {
							savePriceDisplaySettings({ ...settings, modelCurrencies });
							setError("");
						} catch {
							setError("无法保存显示设置，请检查浏览器存储权限。");
						}
					}}
				/>
			</Space>
			{error && <Alert type="error" message={error} />}
		</div>
	);
}
export default function PriceDisplaySettings() {
	const { settings, exchange, error } = usePriceDisplay();
	const [source, setSource] = useState(settings.source);
	const [message, setMessage] = useState("");
	const [saving, setSaving] = useState(false);
	const client = useQueryClient();
	const saveSource = async () => {
		setSaving(true);
		setMessage("");
		try {
			const data = await fetchExchangeRates(source);
			savePriceDisplaySettings({ ...settings, source });
			client.setQueryData(["display-exchange-rates", source], data);
			setMessage("汇率源已验证并保存");
		} catch (error) {
			setMessage(error instanceof Error ? error.message : "无法保存汇率源");
		} finally {
			setSaving(false);
		}
	};
	return (
		<div className="space-y-5 max-w-3xl">
			<Typography.Title level={4}>价格显示</Typography.Title>
			<Typography.Paragraph>
				仅转换显示金额，计费、预算、排序和数据库金额保持 USD。金额编辑框仍以 USD 输入。显示偏好保存在当前浏览器。
			</Typography.Paragraph>
			<Space wrap>
				<span>全局显示币种</span>
				<CurrencySelect
					value={settings.currency}
					onChange={(currency) => {
						try {
							savePriceDisplaySettings({ ...settings, currency });
							setMessage("");
						} catch {
							setMessage("无法保存显示设置");
						}
					}}
				/>
			</Space>
			<div>
				<Typography.Text>汇率数据源</Typography.Text>
				<Input aria-label="汇率数据源" value={source} onChange={(event) => setSource(event.target.value)} />
				<Typography.Paragraph type="secondary">
					默认 Frankfurter / ECB 每日参考汇率。自定义 HTTPS 数据源须支持浏览器跨域访问，返回 USD 为基准的 Frankfurter v2
					数组，或 {"{base: 'USD', date: 'YYYY-MM-DD', rates: {CNY: 7.0, ...}}"}。不向汇率源发送登录凭据。
				</Typography.Paragraph>
				<Space>
					<Button loading={saving} onClick={saveSource}>
						验证并保存数据源
					</Button>
					<Button onClick={() => setSource(DEFAULT_RATE_SOURCE)}>恢复默认地址</Button>
				</Space>
			</div>
			{exchange && (
				<Typography.Paragraph>
					汇率日期：{exchange.date} · 每小时刷新；超过 10 天的汇率不用于显示。
				</Typography.Paragraph>
			)}
			{error && <Alert type="warning" message={error} />}
			{message && <Alert message={message} />}
		</div>
	);
}
