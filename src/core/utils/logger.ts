/**
 * 日志工具模块
 * 使用 winston 提供结构化日志，支持模块前缀和任务 ID
 */

import winston from "winston";

/** 日志器类型 */
export type Logger = winston.Logger;

/** 默认日志级别 */
const DEFAULT_LOG_LEVEL = "info";

/** ANSI 重置码 */
const RESET = "\x1b[0m";

/** 高对比度颜色池 */
const TASK_COLORS = [
	"\x1b[36m", // cyan
	"\x1b[32m", // green
	"\x1b[34m", // blue
	"\x1b[96m", // bright cyan
];

/** task ID -> 颜色索引映射 */
const taskColorMap = new Map<string, number>();

/** 下一个颜色索引 */
let nextColorIndex = 0;

/**
 * 根据 task ID 获取颜色码
 * 每个新 task ID 分配下一个颜色，顺序执行的任务颜色不同
 * @param taskId - 任务 ID
 */
function getTaskColor(taskId: string): string {
	let colorIndex = taskColorMap.get(taskId);
	if (colorIndex === undefined) {
		colorIndex = nextColorIndex;
		taskColorMap.set(taskId, colorIndex);
		nextColorIndex = (nextColorIndex + 1) % TASK_COLORS.length;
	}
	return TASK_COLORS[colorIndex]!;
}

/**
 * 为 task ID 添加颜色（用于日志消息中嵌入 taskId）
 * @param taskId - 任务 ID
 */
export function colorTaskId(taskId: string): string {
	return `${getTaskColor(taskId)}${taskId}${RESET}`;
}

// 配置颜色
// error: 红色, warn: 黄色, info: 绿色, debug: 蓝色
winston.addColors({
	error: "red",
	warn: "yellow",
	info: "green",
	debug: "blue",
});

/**
 * 安全地序列化 JSON，处理循环引用和 Error 不可枚举属性
 * @param value - 需要序列化的值
 */
function safeStringify(value: unknown): string {
	const seen = new WeakSet<object>();
	return JSON.stringify(value, (_key, val) => {
		if (typeof val === "object" && val !== null) {
			if (seen.has(val)) {
				return "[Circular]";
			}
			seen.add(val);
			if (val instanceof Error) {
				const obj: Record<string, unknown> = {};
				for (const key of Object.getOwnPropertyNames(val)) {
					obj[key] = (val as unknown as Record<string, unknown>)[key];
				}
				return obj;
			}
		}
		return val;
	});
}

/** 日志格式化（带模块名和任务 ID） */
const logFormat = winston.format.combine(
	winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
	winston.format.errors({ stack: true }),
	winston.format.printf(({ timestamp, level, message, module, taskId, ...meta }) => {
		const taskPrefix = taskId ? `[task:${String(taskId)}] ` : "";
		const modulePrefix = module ? `[${String(module)}] ` : "";
		// 排除 module 和 taskId 后的其他 meta 信息
		const metaString = Object.keys(meta).length > 0 ? ` ${safeStringify(meta)}` : "";
		return `[${String(timestamp)}] ${String(level).toUpperCase().padEnd(5)}: ${taskPrefix}${modulePrefix}${String(message)}${metaString}`;
	}),
);

/** 控制台格式（带颜色） */
const consoleFormat = winston.format.combine(
	winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
	winston.format.errors({ stack: true }),
	winston.format.colorize({ all: false, level: true }),
	winston.format.printf(({ timestamp, level, message, module, taskId, ...meta }) => {
		const taskPrefix = taskId ? `${getTaskColor(String(taskId))}[task:${String(taskId)}]${RESET} ` : "";
		const modulePrefix = module ? `[${String(module)}] ` : "";
		const metaString = Object.keys(meta).length > 0 ? ` ${safeStringify(meta)}` : "";
		return `[${String(timestamp)}] ${String(level).padEnd(15)}: ${taskPrefix}${modulePrefix}${String(message)}${metaString}`;
	}),
);

/** 主日志实例 */
export const logger = winston.createLogger({
	level: DEFAULT_LOG_LEVEL,
	format: logFormat,
	transports: [
		new winston.transports.Console({
			format: consoleFormat,
		}),
	],
});

/**
 * 更新日志级别（供 config 模块在加载配置后调用）
 * @param level - 新的日志级别
 */
export function setLogLevel(level: string): void {
	logger.level = level;
	logger.info("日志级别已更新", { level: level });
}

/**
 * 创建带有模块前缀的子日志器
 * @param moduleName - 模块名称
 */
export function createModuleLogger(moduleName: string): Logger {
	return logger.child({ module: moduleName });
}

/**
 * 创建带有任务 ID 前缀的子日志器
 * @param taskId - 任务 ID
 * @param moduleName - 可选的模块名
 */
export function createTaskLogger(taskId: string, moduleName?: string): Logger {
	return logger.child({ taskId: taskId, module: moduleName });
}

/**
 * 从 unknown 类型的 catch 参数中安全提取错误消息字符串
 * @param error - catch 块捕获的异常对象
 */
export function toErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
