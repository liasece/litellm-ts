export const formatNumberWithCommas = (
	value: number | null | undefined,
	decimals: number = 0,
	abbreviate: boolean = false,
	showZero: boolean = true,
): string => {
	if (value === null || value === undefined || !Number.isFinite(value) || (value === 0 && !showZero)) {
		return "-";
	}

	const opts: Intl.NumberFormatOptions = {
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals,
	};

	if (!abbreviate) {
		return value.toLocaleString("en-US", opts);
	}

	const sign = value < 0 ? "-" : "";
	const abs = Math.abs(value);
	let scaled = abs;
	let suffix = "";

	if (abs >= 1_000_000) {
		scaled = abs / 1_000_000;
		suffix = "M";
	} else if (abs >= 1_000) {
		scaled = abs / 1_000;
		suffix = "K";
	}

	return `${sign}${scaled.toLocaleString("en-US", opts)}${suffix}`;
};
