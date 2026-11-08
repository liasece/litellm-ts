import { ref } from "vue";
export interface PolicySort {
	key: string;
	desc: boolean;
}
export function createPolicyTableSort<T>(initial: PolicySort, value: (row: T, key: string) => string | number) {
	const sorts = ref<PolicySort[]>([initial]),
		collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });
	function order(key: string) {
		const sort = sorts.value.find((s) => s.key === key);
		return sort ? (sort.desc ? ("desc" as const) : ("asc" as const)) : null;
	}
	function toggle(key: string, event: MouseEvent, numeric = false) {
		const previous = sorts.value.find((s) => s.key === key),
			next = !previous
				? { key, desc: numeric }
				: previous.desc
					? numeric
						? { key, desc: false }
						: null
					: numeric
						? null
						: { key, desc: true };
		const keep = event.shiftKey ? sorts.value.filter((s) => s.key !== key) : [];
		sorts.value = next ? [...keep, next] : keep;
	}
	function rows(data: T[]): T[] {
		return [...data].sort((a, b) => {
			for (const s of sorts.value) {
				const left = value(a, s.key),
					right = value(b, s.key),
					cmp =
						typeof left === "number" && typeof right === "number"
							? left - right
							: collator.compare(String(left), String(right));
				if (cmp) return s.desc ? -cmp : cmp;
			}
			return 0;
		});
	}
	return { sorts, order, toggle, rows };
}
