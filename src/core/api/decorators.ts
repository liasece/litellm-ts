/**
 * 控制器装饰器 — 声明式 API 路由定义
 *
 * 通过方法装饰器和参数装饰器将控制器方法映射为 Express 路由，
 * registerController() 在运行时扫描装饰器元数据并完成路由注册。
 *
 * 元数据存储使用 WeakMap（无需 reflect-metadata 依赖）：
 * - methodMetaStore: HTTP 方法 + 路径
 * - noAuthStore: 跳过认证标记
 * - rawResponseStore: 原始响应标记
 * - paramMetaStore: 参数来源映射
 *
 * TypeScript experimental decorators 对同一方法上的多个装饰器自底向上应用。
 * noAuth/rawResponse 装饰器先于 @get 执行，因此使用独立 WeakMap 存储。
 */

import type { RequestHandler } from "express";

// ========== 内部元数据类型 ==========

/** Express Router 接受的 HTTP 方法 */
export enum HttpMethod {
	Get = "get",
	Post = "post",
	Put = "put",
	Patch = "patch",
	Delete = "delete",
}

/** 参数来源类型，对应 Express 请求对象的属性 */
export enum ParamKind {
	Param = "param",
	Query = "query",
	Body = "body",
	Request = "request",
}

/** HTTP 方法 + 路径（由 get/post/put/patch/del 装饰器设置） */
interface MethodMeta {
	readonly httpMethod: HttpMethod;
	readonly path: string;
}

/** 路径参数：从 req.params[name] 提取，name 必填 */
export interface PathParamMeta {
	/** 方法参数在参数列表中的位置（从 0 开始） */
	readonly index: number;
	/** 参数来源类型 */
	readonly kind: ParamKind.Param;
	/** req.params 中的键名 */
	readonly name: string;
}

/** 查询参数：从 req.query 提取，省略 name 时取整个 query */
export interface QueryParamMeta {
	/** 方法参数在参数列表中的位置（从 0 开始） */
	readonly index: number;
	/** 参数来源类型 */
	readonly kind: ParamKind.Query;
	/** req.query 中的键名，省略时提取整个 query 对象 */
	readonly name?: string;
}

/** 请求体：从 req.body 提取 */
export interface BodyParamMeta {
	/** 方法参数在参数列表中的位置（从 0 开始） */
	readonly index: number;
	/** 参数来源类型 */
	readonly kind: ParamKind.Body;
}

/** 原始请求对象：直接注入 Express Request */
export interface RequestParamMeta {
	/** 方法参数在参数列表中的位置（从 0 开始） */
	readonly index: number;
	/** 参数来源类型 */
	readonly kind: ParamKind.Request;
}

/** 参数装饰器收集的元数据（区分联合，kind 决定可选字段） */
export type ParamMeta = PathParamMeta | QueryParamMeta | BodyParamMeta | RequestParamMeta;

// ========== 元数据存储 ==========

const methodMetaStore = new WeakMap<object, MethodMeta>();
const noAuthStore = new WeakMap<object, boolean>();
const rawResponseStore = new WeakMap<object, boolean>();
const middlewareStore = new WeakMap<object, RequestHandler[]>();
const paramMetaStore = new WeakMap<abstract new (...args: unknown[]) => unknown, Map<string, ParamMeta[]>>();

// ========== 内部访问器 ==========

/**
 * 获取 HTTP 方法 + 路径元数据
 * @param method - 被装饰的方法引用
 */
export function getMethodMeta(method: object): MethodMeta | undefined {
	return methodMetaStore.get(method);
}

/**
 * 获取参数元数据
 * @param constructor - 控制器构造函数
 * @param propertyKey - 方法名
 */
export function getParamMeta(constructor: abstract new (...args: unknown[]) => unknown, propertyKey: string): ParamMeta[] | undefined {
	return paramMetaStore.get(constructor)?.get(propertyKey);
}

/**
 * 是否标记为免认证
 * @param method - 被装饰的方法引用
 */
export function isNoAuth(method: object): boolean {
	return noAuthStore.get(method) === true;
}

/**
 * 是否标记为原始响应
 * @param method - 被装饰的方法引用
 */
export function isRawResponse(method: object): boolean {
	return rawResponseStore.get(method) === true;
}

/**
 * 获取方法上的额外中间件
 * @param method - 被装饰的方法引用
 */
export function getMiddleware(method: object): RequestHandler[] | undefined {
	return middlewareStore.get(method);
}

/**
 * 获取或创建方法的参数元数据列表
 * @param target - 控制器构造函数
 * @param propertyKey - 方法名
 */
function getOrCreateParamMeta(target: abstract new (...args: unknown[]) => unknown, propertyKey: string): ParamMeta[] {
	let propMap = paramMetaStore.get(target);
	if (propMap === undefined) {
		propMap = new Map<string, ParamMeta[]>();
		paramMetaStore.set(target, propMap);
	}
	let params = propMap.get(propertyKey);
	if (params === undefined) {
		params = [];
		propMap.set(propertyKey, params);
	}
	return params;
}

/**
 * 标准化 target 参数为构造函数
 * @param target - 装饰器 target（可能是原型或构造函数）
 */
function normalizeTarget(target: object): abstract new (...args: unknown[]) => unknown {
	return (typeof target === "function" ? target : target.constructor) as abstract new (...args: unknown[]) => unknown;
}

// ========== HTTP 方法装饰器 ==========

/**
 * 创建 HTTP 方法装饰器
 * @param httpMethod - HTTP 方法枚举值
 */
function httpMethod(httpMethod: HttpMethod): (path: string) => MethodDecorator {
	return (path) => (_target, _propertyKey, descriptor) => {
		const method = (descriptor as PropertyDescriptor).value;
		if (typeof method === "function") {
			methodMetaStore.set(method, { httpMethod: httpMethod, path: path });
		}
	};
}

/** 注册 GET 路由 */
export const get = httpMethod(HttpMethod.Get);
/** 注册 POST 路由 */
export const post = httpMethod(HttpMethod.Post);
/** 注册 PUT 路由 */
export const put = httpMethod(HttpMethod.Put);
/** 注册 PATCH 路由 */
export const patch = httpMethod(HttpMethod.Patch);
/** 注册 DELETE 路由 */
export const del = httpMethod(HttpMethod.Delete);

// ========== 参数装饰器 ==========

/**
 * 从 req.params[name] 提取路径参数
 * @param name - req.params 中的键名
 */
export function param(name: string): ParameterDecorator {
	return (target, propertyKey, parameterIndex) => {
		getOrCreateParamMeta(normalizeTarget(target), String(propertyKey)).push({
			index: parameterIndex,
			kind: ParamKind.Param,
			name: name,
		});
	};
}

/**
 * 从 req.query 提取查询参数，省略 name 时提取整个 query 对象
 * @param name - req.query 中的键名，省略时提取整个 query 对象
 */
export function query(name?: string): ParameterDecorator {
	return (target, propertyKey, parameterIndex) => {
		getOrCreateParamMeta(normalizeTarget(target), String(propertyKey)).push({
			index: parameterIndex,
			kind: ParamKind.Query,
			name: name,
		});
	};
}

/** 从 req.body 提取请求体 */
export function body(): ParameterDecorator {
	return (target, propertyKey, parameterIndex) => {
		getOrCreateParamMeta(normalizeTarget(target), String(propertyKey)).push({
			index: parameterIndex,
			kind: ParamKind.Body,
		});
	};
}

/** 注入原始 Express Request 对象 */
export function req(): ParameterDecorator {
	return (target, propertyKey, parameterIndex) => {
		getOrCreateParamMeta(normalizeTarget(target), String(propertyKey)).push({
			index: parameterIndex,
			kind: ParamKind.Request,
		});
	};
}

// ========== 特殊修饰装饰器 ==========

/**
 * 跳过自动 res.json() — handler 直接操作 Express req/res
 *
 * 适用于以下场景：
 * 1. 二进制响应下载：Content-Type 非 JSON
 * 2. 流式响应：需分块写入 res
 */
export function rawResponse(): MethodDecorator {
	return (_target, _propertyKey, descriptor) => {
		const method = (descriptor as PropertyDescriptor).value;
		if (typeof method === "function") {
			rawResponseStore.set(method, true);
		}
	};
}

/**
 * 跳过认证中间件 — 仅当 registerController 传入 requireAuth 时生效
 */
export function noAuth(): MethodDecorator {
	return (_target, _propertyKey, descriptor) => {
		const method = (descriptor as PropertyDescriptor).value;
		if (typeof method === "function") {
			noAuthStore.set(method, true);
		}
	};
}

/**
 * 为路由注册额外中间件（如 multer）
 *
 * 多次装饰会累加中间件，按装饰顺序（自底向上）依次执行。
 * @param handlers - Express 请求处理函数（中间件）
 */
export function middleware(...handlers: RequestHandler[]): MethodDecorator {
	return (_target, _propertyKey, descriptor) => {
		const method = (descriptor as PropertyDescriptor).value;
		if (typeof method === "function") {
			const existing = middlewareStore.get(method) ?? [];
			middlewareStore.set(method, [...handlers, ...existing]);
		}
	};
}
