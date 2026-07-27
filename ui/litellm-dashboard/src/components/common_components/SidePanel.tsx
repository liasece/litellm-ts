import { Drawer, type DrawerProps } from "antd";

export const SIDE_PANEL_WIDTH = "clamp(50vw, 1200px, 80vw)";

type SidePanelProps = Omit<DrawerProps, "placement">;

export default function SidePanel({ width = SIDE_PANEL_WIDTH, ...props }: SidePanelProps) {
	return <Drawer {...props} placement="right" width={width} />;
}
