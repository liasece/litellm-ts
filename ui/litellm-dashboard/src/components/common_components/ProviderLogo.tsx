import { useState } from "react";

interface ProviderLogoProps {
	provider: string;
	logo?: string | null;
	className?: string;
	fallbackClassName?: string;
}

export default function ProviderLogo({
	provider,
	logo,
	className = "h-4 w-4 object-contain",
	fallbackClassName = "flex h-4 w-4 items-center justify-center rounded-full bg-gray-200 text-xs",
}: ProviderLogoProps) {
	const [failed, setFailed] = useState(false);

	if (!logo || failed) {
		return <span className={fallbackClassName}>{provider.charAt(0) || "-"}</span>;
	}

	return (
		// Provider logos are dynamic external URLs and need the stateful inline fallback above.
		// eslint-disable-next-line @next/next/no-img-element
		<img
			src={logo}
			alt={`${provider} logo`}
			className={className}
			onError={() => setFailed(true)}
		/>
	);
}
