/**
 * 让 supertest 通过 IPv6 回环 `[::1]` 连接它自己起的临时服务。
 *
 * 背景：supertest 每次请求都 `app.listen(0)` 起一个临时服务，不指定 host 时 Node 绑 `::`
 * （双栈）；请求 URL 里固定写 `127.0.0.1`。macOS 上这两件事组合出一个坑：`::` 的端口分配
 * 不避开只绑 `127.0.0.1`/`0.0.0.0` 的其它进程，于是 `:::<port>` 与别人在 `127.0.0.1:<port>`
 * 上的监听可以同时存在，而 IPv4 连接按「更具体地址优先」交给**对方**。
 *
 * 本机就有这样的邻居（例如 127.0.0.1:57652 的 DeepSeek Harness GUI）。一旦撞上，用例会读到
 * 别人的页面（随机 404/401/文本不符），对方重置连接时就是 `read ECONNRESET`；Jest 多 worker
 * 并行时端口轮的越快越容易撞上，表现为与断言无关的随机失败。
 *
 * 修法：不改绑定方式（`listen(0)` 是同步绑定的，supertest 依赖绑定后立刻读 `address()`），
 * 只把请求地址换成 `[::1]`——IPv6 回环只会落到我们自己绑的 `::` 服务上，不会被 IPv4 邻居抢走。
 * 若被测服务显式绑在 IPv4 上（`family` 为 IPv4），仍按 `127.0.0.1` 访问。
 */
import type { Server } from "node:http";
import type Test from "supertest/lib/test";

type TestPrototype = Test & {
	serverAddress(app: Server, path: string): string;
};

const testModule = jest.requireActual<{ default?: Test } & Record<string, unknown>>("supertest/lib/test");
// supertest 以 CJS 导出类本身，ts-jest 转译后可能是 default 包装
const TestClass = (testModule.default ?? testModule) as unknown as { prototype: TestPrototype };
const original = TestClass.prototype.serverAddress;

TestClass.prototype.serverAddress = function serverAddressOnIpv6Loopback(this: TestPrototype, app: Server, path: string): string {
	const url = original.call(this, app, path);
	const address = app.address();
	// Node 的 family 在旧版本是数字 6，新版本是字符串 "IPv6"
	const family = address !== null && typeof address === "object" ? (address as { family?: string | number }).family : undefined;
	const isIpv6Wildcard = family === "IPv6" || family === 6;
	// 只替换 host，端口与路径保持 supertest 的计算结果
	return isIpv6Wildcard ? url.replace("127.0.0.1", "[::1]") : url;
};
