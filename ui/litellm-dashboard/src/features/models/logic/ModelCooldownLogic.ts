import type { ModelCooldown } from "../support/ModelModels";

/**
 * 把服务端剩余毫秒换算成本地截止时刻。
 *
 * 不直接用 `expires_at` 做减法：浏览器时钟可能和服务端不同步，而 `remaining_ms` 是
 * 同一个响应里刚算出的相对时间。列表轮询会不断刷新这个截止时刻，网络延迟最多让
 * 倒计时晚一个轮询周期内的几毫秒。
 */
export function cooldownDeadline(cooldown: ModelCooldown, receivedAt = Date.now()): number {
	const remaining = Number.isFinite(cooldown.remaining_ms) ? Math.max(0, cooldown.remaining_ms) : 0;
	return receivedAt + remaining;
}

const deadlines = new WeakMap<ModelCooldown, number>();

/**
 * 同一份冷却快照在桌面表格和移动卡片里各挂载一次，两处必须共用首次算出的截止时刻。
 * 如果各自在挂载时调用 `cooldownDeadline`，两次挂载相差几百毫秒，跨过秒边界后
 * 会一个显示 45s、另一个显示 46s，切换布局时看起来像时间倒退。
 *
 * 以快照对象为键也意味着轮询拿到新对象后自然重新计时；调用方不要原地修改旧快照。
 */
export function cooldownDeadlineForSnapshot(cooldown: ModelCooldown): number {
	let deadline = deadlines.get(cooldown);
	if (deadline === undefined) {
		deadline = cooldownDeadline(cooldown);
		deadlines.set(cooldown, deadline);
	}
	return deadline;
}

/**
 * 冷却标签的紧凑倒计时。向上取整，避免还有几百毫秒时显示 0s；
 * 超过一分钟才展开到分钟，和表格里其他倒计时的空间约束一致。
 */
export function formatCooldownDuration(remainingMs: number): string | null {
	if (!Number.isFinite(remainingMs) || remainingMs <= 0) return null;
	const totalSeconds = Math.ceil(remainingMs / 1000);
	if (totalSeconds < 60) return `${totalSeconds}s`;
	const totalMinutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (totalMinutes < 60) return seconds === 0 ? `${totalMinutes}m` : `${totalMinutes}m ${seconds}s`;
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}
