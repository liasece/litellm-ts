import { inject, provide, type InjectionKey } from "vue";
import { nextUiIdentity } from "../../platform/ui/UiIdentity";
const keyFormIdentity: InjectionKey<string> = Symbol("VirtualKeyFormIdentity");
export function provideKeyFormIdentity(kind: string): (name: string) => string {
	const prefix = nextUiIdentity(kind);
	provide(keyFormIdentity, prefix);
	return (name) => prefix + "-" + name;
}
export function useKeyFieldIdentity(): (name: string) => string {
	const prefix = inject(keyFormIdentity, "virtual-key");
	return (name) => prefix + "-" + name;
}
