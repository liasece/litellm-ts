import { useState } from "react";

interface PromptProviderLogoProps {
	provider: string | null;
	logo: string | null | undefined;
}

export default function PromptProviderLogo({
	provider,
	logo,
}: PromptProviderLogoProps) {
	const [failed, setFailed] = useState(false);

	if (!provider || !logo || failed) {
		return (
			<div className="flex h-4 w-4 items-center justify-center rounded-full bg-gray-200 text-xs">
				{provider?.charAt(0) || "-"}
			</div>
		);
	}

	return (
		<img
			src={logo}
			alt={`${provider} logo`}
			className="h-4 w-4"
			onError={() => setFailed(true)}
		/>
	);
}

