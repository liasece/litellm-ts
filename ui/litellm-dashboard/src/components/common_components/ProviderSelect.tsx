import { useProviderFields } from "@/app/(dashboard)/hooks/providers/useProviderFields";
import { Select, type SelectProps } from "antd";
import { useMemo } from "react";
import type { ProviderCreateInfo } from "../networking";
import { ProviderLogo } from "../molecules/models/ProviderLogo";

type ProviderValueField = "provider" | "litellm_provider";

export interface ProviderSelectProps
	extends Omit<SelectProps<string>, "children" | "loading" | "optionFilterProp" | "options"> {
	valueField?: ProviderValueField;
}

interface ProviderGroup {
	label: string;
	providers: ProviderCreateInfo[];
}

const POPULAR_PROVIDER_KEYS = ["Anthropic", "OpenAI"] as const;

function groupProviders(
	providerMetadata: ProviderCreateInfo[],
	valueField: ProviderValueField,
	currentValue?: string,
): ProviderGroup[] {
	const uniqueProviders = new Map<string, ProviderCreateInfo>();
	for (const providerInfo of providerMetadata) {
		const optionValue = providerInfo[valueField];
		if (optionValue && !uniqueProviders.has(optionValue)) {
			uniqueProviders.set(optionValue, providerInfo);
		}
	}

	const popularProviders = POPULAR_PROVIDER_KEYS.flatMap((providerKey) => {
		const providerInfo = [...uniqueProviders.values()].find((item) => item.provider === providerKey);
		return providerInfo ? [providerInfo] : [];
	});
	const popularValues = new Set(popularProviders.map((providerInfo) => providerInfo[valueField]));
	const allProviders = [...uniqueProviders.values()]
		.filter((providerInfo) => !popularValues.has(providerInfo[valueField]))
		.sort((a, b) => a.provider_display_name.localeCompare(b.provider_display_name));

	if (currentValue && !uniqueProviders.has(currentValue)) {
		allProviders.push({
			provider: currentValue,
			provider_display_name: currentValue,
			litellm_provider: currentValue,
			credential_fields: [],
		});
	}

	return [
		{ label: "Popular", providers: popularProviders },
		{ label: "All Providers", providers: allProviders },
	];
}

export default function ProviderSelect({ valueField = "provider", value, ...selectProps }: ProviderSelectProps) {
	const { data: providerMetadata, isLoading, error } = useProviderFields();
	const providerGroups = useMemo(
		() => groupProviders(providerMetadata ?? [], valueField, value ?? undefined),
		[providerMetadata, value, valueField],
	);
	const providerCount = providerGroups.reduce((count, group) => count + group.providers.length, 0);
	const errorText = error ? (error instanceof Error ? error.message : "Failed to load providers") : null;

	return (
		<Select
			{...selectProps}
			value={value}
			virtual={false}
			showSearch
			loading={isLoading}
			placeholder={isLoading ? "Loading providers..." : (selectProps.placeholder ?? "Select a provider")}
			optionFilterProp="data-label"
		>
			{errorText && providerCount === 0 && (
				<Select.Option key="__error" value="" disabled>
					{errorText}
				</Select.Option>
			)}
			{providerGroups.map((group) => (
				<Select.OptGroup key={group.label} label={group.label}>
					{group.providers.map((providerInfo) => {
						const optionValue = providerInfo[valueField];
						return (
							<Select.Option
								key={`${valueField}:${optionValue}`}
								value={optionValue}
								data-label={providerInfo.provider_display_name}
							>
								<div className="flex items-center space-x-2">
									<ProviderLogo provider={providerInfo.provider} className="h-5 w-5" />
									<span>{providerInfo.provider_display_name}</span>
								</div>
							</Select.Option>
						);
					})}
				</Select.OptGroup>
			))}
		</Select>
	);
}
