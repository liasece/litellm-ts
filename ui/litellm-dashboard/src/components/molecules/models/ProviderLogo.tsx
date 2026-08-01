import React, { useState } from "react";
import { getModelLogoAndName, getProviderLogoAndName } from "../../provider_info_helpers";

interface ProviderLogoProps {
	provider: string;
	modelName?: string;
	className?: string;
}

export const ProviderLogo: React.FC<ProviderLogoProps> = ({ provider, modelName, className = "w-4 h-4" }) => {
	const [hasError, setHasError] = useState(false);
	const modelProvider = modelName ? getModelLogoAndName(provider, modelName) : undefined;
	const { logo, displayName } = modelProvider ?? getProviderLogoAndName(provider);

	const showFallback = hasError || !logo;

	if (showFallback) {
		return (
			<div className={`${className} rounded-full bg-gray-200 flex items-center justify-center text-xs`}>
				{provider?.charAt(0) || "-"}
			</div>
		);
	}

	return <img src={logo} alt={`${displayName} logo`} className={className} onError={() => setHasError(true)} />;
};
