import { formatNumberWithCommas } from "@/utils/dataUtils";

export function valueFormatter(number: number) {
  if (number >= 1000000) {
    return (number / 1000000).toFixed(2) + "M";
  }
  if (number >= 1000) {
    return number / 1000 + "k";
  }
  return number.toString();
}

export const valueFormatterTokens = (value: number) => formatNumberWithCommas(value, 0, false);

export function valueFormatterSpend(number: number) {
  if (number === 0) return "$0";
  if (number >= 1000000) {
    return "$" + number / 1000000 + "M";
  }
  if (number >= 1000) {
    return "$" + number / 1000 + "k";
  }
  return "$" + number;
}
