/**
 * 解析 lucide 图标名到图标节点。
 *
 * 定义表由 lucide 导出生成，键名混用两种形态（`ArrowDown` 与 `GripVerticalIcon`）。
 * 名字对不上时组件只会渲染空 `<svg>`：没有报错、没有占位，屏幕上就是“什么都没有”，
 * 因此这里同时接受带后缀与不带后缀的写法，调用方不必记住某个图标属于哪种形态。
 */
export interface IconNode {
	tag: string;
	attrs: Record<string, string | number>;
}

export type IconDefinitions = Readonly<Record<string, readonly IconNode[]>>;

export function resolveIconNodes(definitions: IconDefinitions, name: string): readonly IconNode[] {
	const direct = definitions[name];
	if (direct?.length) return direct;
	const suffixed = definitions[name + "Icon"];
	if (suffixed?.length) return suffixed;
	if (name.endsWith("Icon")) {
		const bare = definitions[name.slice(0, -"Icon".length)];
		if (bare?.length) return bare;
	}
	return [];
}
