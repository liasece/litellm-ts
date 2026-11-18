# Fallback 与 Alias 的候选树

一条请求失败之后换哪个模型，由数据库 `LiteLLM_Config.router_settings.fallbacks` 与
`router_settings.model_group_alias` 共同描述，二者都由 Dashboard 维护，`config.yaml` 不再读取。
两者现在都表达「有序候选 + 是否继续向下」：这是为了在配置出错或上游整体故障时，
流量不会走到配置者没有预期的模型上（例如便宜的模型失败后一路 fallback 到最贵的模型）。

## 两种配置的写法

`fallbacks` 的每个条目（按 PY 兼容形态仍是对象数组，同名键先出现者生效）：

```json
{
  "gpt-6-astra": ["gpt-6-sol", "k3"],
  "cheap-test": { "targets": ["gpt-5.6-terra", "qwen3.8-27b"], "recurse": false }
}
```

第一条是紧凑写法：按顺序尝试，默认允许每个目标继续用它自己的 fallback。第二条显式关闭递归：
目标失败即停在这一层，不再沿目标自身的 fallback 继续。

`model_group_alias` 的对象形态新增有序目标与同一个开关，`model` 是只有一项时的历史写法：

```json
{
  "cheap": { "targets": ["cheap-a", "cheap-b"], "recurse": false },
  "sonnet": "gpt-5.6-terra"
}
```

`recurse` 缺省为 `true`，与既有配置的行为一致。别名写成 `string[]` 时，首项是主目标，其余是同级候选；
只有对象形态能关闭递归。

## 展开顺序

运行时把配置展开成一棵树，并按**深度优先**的顺序尝试：

```
fallbacks:  a → [b, c],  b → [d]
alias:      a → [x]        # 无
实际顺序：  a → b → d → c
```

- 每个节点失败后先走它的第一个目标的子树，走完再回到下一个兄弟目标。
- `recurse: false` 只剪掉「目标自身的子树」，同级兄弟仍然会被尝试。所以
  `a: {targets: [b, c], recurse: false}` 配 `b: [d]` 的顺序是 `a → b → c`，`d` 不会被尝试。
- 该规则对别名解析结果同样生效：`cheap → [x]`（`x` 解析到 `g`）且 `recurse: false` 时，`g` 的链不会被使用。
- 已经作为一跳尝试过的模型组不会重复排队；计划总量受 `max_fallbacks` 限制（内部展开上限 50 条）。
- 别名自己声明的目标排在显式 `fallbacks[别名]` 条目之后，保持「精确名字优先于解析后的名字」的历史语义。

## 关于别名目标的取舍

时段 alias（`model` + `schedule`）的默认目标**不会**成为别的时段的备选：另一个时段的目标是「那个时段的默认目标」，
不是「失败后的候选」。只有显式声明 `targets` 的别名才产生同级候选，且时段命中的目标会升为该次请求的主目标，
其余目标保持声明顺序排在后面。

## 在 Dashboard 里编辑

Fallback 和别名目标都是「有序列表 + 一个递归开关」，界面用同一套卡片表达：每个目标一张带序号的框，
首项是主目标，后面依次是失败后的候选；序号就是尝试顺序，没有单独的排序控件。递归开关放在列表下方的
独立区域，因为它作用于整组目标而不是某一张卡片，和「继续向下」的语义一致。

保存时保持配置紧凑：允许递归写回 `["a","b"]`，关闭递归才写 `{"targets": ["a","b"], "recurse": false}`，
所以数据库里已有的旧配置不会因为经过界面而被改写成更啰嗦的形态。只读接口返回的两种形态都按同一套逻辑
归一化后渲染，界面上看不出差异。

## 与请求级计划的关系

候选顺序在请求第一次需要 fallback 时展开一次，随请求上下文（`fallbackPlan` / `fallbackCursor`）传递。
RouterExecution、直连的 Anthropic Messages 端点与 Chat 流式中途切换共用这一份顺序，所以
「日志里显示的顺序」和「实际尝试的顺序」不会分叉。流式响应一旦已经向客户端写出答案内容，
就不再切换模型（见 [开发文档](development.md) 的流式 fallback 判据）。
