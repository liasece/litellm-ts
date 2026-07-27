import { Drawer, type DrawerProps } from "antd";

export const SIDE_PANEL_WIDTH = "clamp(50vw, 1200px, 80vw)";

type SidePanelProps = Omit<DrawerProps, "placement" | "width">;

export default function SidePanel(props: SidePanelProps) {
	return <Drawer {...props} placement="right" width={SIDE_PANEL_WIDTH} />;
}
