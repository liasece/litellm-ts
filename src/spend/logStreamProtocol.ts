/**
 * 日志流 WebSocket 的握手约定。
 *
 * 浏览器无法在 WebSocket 握手时自定义请求头，密钥通过 `litellm_<key>` 子协议提交；
 * 这里声明客户端必须回显的固定子协议，详情流与列表通知流共用。
 */
export const LOG_STREAM_SUBPROTOCOL = "litellm-log-stream";
