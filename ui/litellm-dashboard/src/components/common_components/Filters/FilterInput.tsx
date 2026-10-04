import { cx } from "@/lib/cva.config";
import { Input } from "antd";
import debounce from "lodash/debounce";
import { LucideIcon } from "lucide-react";
import React, { useCallback, useEffect, useMemo, useState } from "react";

interface FilterInputProps {
	placeholder?: string;
	value: string;
	onChange: (value: string) => void;
	icon?: LucideIcon;
	className?: string;
	style?: React.CSSProperties;
}

const DEBOUNCE_DELAY = 300;

export const FilterInput: React.FC<FilterInputProps> = ({ placeholder, value, onChange, icon: Icon, className }) => {
	const [localValue, setLocalValue] = useState(value);
	// Keep the field in sync when the controlled value changes from the outside
	// (e.g. the parent clears a filter). Adjusting state during render with a guard
	// is the documented replacement for a state-syncing effect.
	const [prevValue, setPrevValue] = useState(value);
	if (!Object.is(value, prevValue)) {
		setPrevValue(value);
		setLocalValue(value);
	}

	const debouncedOnChange = useMemo(() => debounce((val: string) => onChange(val), DEBOUNCE_DELAY), [onChange]);

	useEffect(() => {
		return () => {
			debouncedOnChange.cancel();
		};
	}, [debouncedOnChange]);

	const handleChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			const newValue = e.target.value;
			setLocalValue(newValue);
			debouncedOnChange(newValue);
		},
		[debouncedOnChange],
	);

	return (
		<Input
			placeholder={placeholder}
			value={localValue}
			onChange={handleChange}
			prefix={Icon ? <Icon size={16} className="text-gray-500" /> : undefined}
			className={cx("w-64", className)}
		/>
	);
};
