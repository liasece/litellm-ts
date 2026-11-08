import { defineComponent, h, type CSSProperties, type PropType } from "vue";
import type { UsageRankingViewport } from "../logic/UsageRankingViewportLogic";

/** Other charts retain their original direct children and CSS layout. */
export default defineComponent({
	name: "UsageChartDrawingLayer",
	props: {
		active: Boolean,
		viewport: { type: Object as PropType<UsageRankingViewport | null>, default: null },
	},
	setup(props, { slots }) {
		return () => {
			const children = slots.default?.();
			if (!props.active) return children;
			const viewport = props.viewport;
			const style: CSSProperties | undefined = viewport
				? {
						width: viewport.width + "px",
						height: viewport.height + "px",
						transform: "matrix(" + [viewport.scale, 0, 0, viewport.scale, viewport.offsetX, viewport.offsetY].join(",") + ")",
					}
				: undefined;
			return h("div", { class: "usage-chart-drawing", style }, children);
		};
	},
});
