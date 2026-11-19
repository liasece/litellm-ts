import { usageColors } from "./UsageChartLogic";

/**
 * Activity 堆叠图的系列色板。
 *
 * 图里每个实体一段、没有 “Other” 兜底，所以颜色数量必须跟着实体数量增长：前 14 个沿用
 * 原有语义色板，之后按黄金角补充色相，保证同一张图里没有两个系列共用同一种颜色。
 * 十几种以上颜色已经无法靠肉眼精确区分，身份由图例与 tooltip 的文案承担；颜色只负责
 * “悬浮到某一段时能对回唯一一条图例”，所以这里要求的是唯一与相邻可辨，而不是全谱可分。
 */
const BASE_SERIES_COLORS = [
	"indigo",
	"cyan",
	"emerald",
	"amber",
	"rose",
	"violet",
	"orange",
	"blue",
	"pink",
	"fuchsia",
	"lime",
	"purple",
	"green",
	"red",
] as const;
/** 黄金角让相邻序号的候选色相互相远离，避免两个新系列落在同一色相区。 */
const GOLDEN_ANGLE = 137.508;
/** 每个序号在黄金角附近取 60 个候选（每 6° 一个），再按与已用色的距离选最远的那个。 */
const HUE_STEP = 6;
const HUE_CANDIDATES = 60;
const EXTRA_SATURATION = 70;
/** 交替明度，让同色相区里的两个系列也能靠深浅区分；都保持在白底上可辨认的中等明度。 */
const EXTRA_LIGHTNESS = [42, 52, 60] as const;
/** 与上一个系列的权重：不为 1，避免为了相邻反差把颜色整体推离已用色。 */
const ADJACENT_WEIGHT = 0.5;

function hslToHex(hue: number, saturation: number, lightness: number): string {
	const s = saturation / 100,
		l = lightness / 100,
		chroma = (1 - Math.abs(2 * l - 1)) * s,
		sector = hue / 60,
		second = chroma * (1 - Math.abs((sector % 2) - 1));
	let rgb: [number, number, number];
	if (sector < 1) rgb = [chroma, second, 0];
	else if (sector < 2) rgb = [second, chroma, 0];
	else if (sector < 3) rgb = [0, chroma, second];
	else if (sector < 4) rgb = [0, second, chroma];
	else if (sector < 5) rgb = [second, 0, chroma];
	else rgb = [chroma, 0, second];
	const offset = l - chroma / 2;
	return (
		"#" +
		rgb
			.map((value) => Math.round((value + offset) * 255))
			.map((value) => value.toString(16).padStart(2, "0"))
			.join("")
	);
}

function channels(color: string): [number, number, number] {
	return [Number.parseInt(color.slice(1, 3), 16), Number.parseInt(color.slice(3, 5), 16), Number.parseInt(color.slice(5, 7), 16)];
}

/**
 * 加权 RGB 距离（redmean）：比裸欧氏距离更接近人眼对色差的感受，足够挑选相邻系列色。
 * @param left - 十六进制颜色
 * @param right - 十六进制颜色
 */
function colorDistance(left: string, right: string): number {
	const [leftRed, leftGreen, leftBlue] = channels(left),
		[rightRed, rightGreen, rightBlue] = channels(right),
		redMean = (leftRed + rightRed) / 2,
		red = leftRed - rightRed,
		green = leftGreen - rightGreen,
		blue = leftBlue - rightBlue;
	return Math.sqrt((2 + redMean / 256) * red * red + 4 * green * green + (2 + (255 - redMean) / 256) * blue * blue);
}

/**
 * 生成一组两两不同、且相邻可辨的系列颜色。
 * @param count - 需要的颜色数量；0 返回空数组
 */
export function activitySeriesColors(count: number): string[] {
	const colors = BASE_SERIES_COLORS.slice(0, Math.max(0, count)).map((name) => usageColors[name]!);
	for (let index = colors.length; index < count; index++) {
		const previous = colors[index - 1]!;
		let chosen = "",
			bestScore = -1,
			fallback = "",
			fallbackScore = -1;
		for (let step = 0; step < HUE_CANDIDATES; step++) {
			const hue = (index * GOLDEN_ANGLE + step * HUE_STEP) % 360,
				candidate = hslToHex(hue, EXTRA_SATURATION, EXTRA_LIGHTNESS[index % EXTRA_LIGHTNESS.length]!),
				spread = Math.min(...colors.map((color) => colorDistance(candidate, color))),
				score = spread + colorDistance(candidate, previous) * ADJACENT_WEIGHT;
			if (score > fallbackScore) {
				fallbackScore = score;
				fallback = candidate;
			}
			// 候选空间有限（60 档色相 × 3 种明度），已用过的颜色即使分数最高也不能再选，
			// 否则两个系列会共用一色；只有候选全被占用时才退回最高分。
			if (!colors.includes(candidate) && score > bestScore) {
				bestScore = score;
				chosen = candidate;
			}
		}
		colors.push(chosen || fallback);
	}
	return colors;
}
