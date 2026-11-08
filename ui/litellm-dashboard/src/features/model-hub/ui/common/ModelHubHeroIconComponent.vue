<script lang="ts">
import { defineComponent, h } from "vue";
import icons from "../../data/ModelHubHeroIconsData.json";
interface SvgNode {
	tag: string;
	attrs: Record<string, string | number | boolean | undefined>;
	children: SvgNode[];
}
const definitions: Record<string, SvgNode> = icons;
function node(item: SvgNode): ReturnType<typeof h> {
	return h(item.tag, item.attrs, item.children.map(node));
}
export default defineComponent({
	name: "ModelHubHeroIconComponent",
	props: { name: { type: String, required: true }, size: { type: Number, default: 24 } },
	setup(props) {
		return () => {
			const icon = definitions[props.name];
			return h(
				"svg",
				{
					...icon?.attrs,
					width: props.size,
					height: props.size,
					class: "hub-hero-icon",
					"aria-hidden": "true",
					focusable: "false",
				},
				icon?.children.map(node),
			);
		};
	},
});
</script>
<style>
.hub-hero-icon {
	display: inline-block;
	vertical-align: middle;
	flex-shrink: 0;
}
</style>
