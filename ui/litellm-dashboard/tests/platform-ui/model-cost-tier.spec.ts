import { expect, test } from "@playwright/test";

test("peak-priced models show the off-peak and peak rows, flat models stay on one row", async ({ page }) => {
	await page.goto("/ui/tests/platform-ui/model-cost-tier.html");

	const peakCell = page.locator('[data-model="peak"] .model-costs');
	const offPeak = peakCell.locator('[data-tier="base"]');
	const peak = peakCell.locator('[data-tier="peak"]');

	// 两排：空闲价是基础价，峰时价按倍率放大，档位标签各自说明。
	await expect(offPeak).toContainText("Off-peak");
	await expect(offPeak).toContainText("$0.1500");
	await expect(offPeak).toContainText("$0.6000");
	await expect(offPeak).toContainText("$0.0030");
	await expect(peak).toContainText("Peak ×2");
	await expect(peak).toContainText("$0.3000");
	await expect(peak).toContainText("$1.2000");
	await expect(peak).toContainText("$0.0060");

	// 悬停给出窗口与时区，操作者不用回配置里找时段。
	await expect(peak.locator(".model-costs__tier")).toHaveAttribute("title", /Mon–Fri 09:00–12:00, Mon–Fri 14:00–18:00/);
	await expect(peak.locator(".model-costs__tier")).toHaveAttribute("title", /Asia\/Shanghai/);

	// 屏幕阅读器按“档位 → 字段”读出两排，不依赖视觉换行。
	await expect(peakCell).toHaveAttribute("aria-label", /^Off-peak: Input \$0\.1500, Output \$0\.6000, Cache read \$0\.0030; Peak ×2: /);

	const flatCell = page.locator('[data-model="flat"] .model-costs');
	await expect(flatCell.locator(".model-costs__row")).toHaveCount(1);
	await expect(flatCell.locator(".model-costs__tier")).toHaveCount(0);
	await expect(flatCell).toContainText("$0.2500");
	await expect(flatCell).toHaveAttribute("aria-label", "Input $0.2500, Output $1.0000, Cache read $0.1250");
});
