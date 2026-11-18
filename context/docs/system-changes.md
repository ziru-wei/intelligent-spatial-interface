# Pending System Changes

基于 `in-situ-response` @ `d32950e`。每一条写清现状、问题、建议改法。

## 1. Separate Local Context from Global Context and Combine Them

### Current Behavior

`jev_read_request`（[jev-pipeline.mjs#L21-L44](https://github.com/ziru-wei/intelligent-spatial-interface/blob/d32950e61b3b8a3f421fd2510cd7c0481c1965b2/editor/scripts/jev-pipeline.mjs#L21-L44)）一次 Jev call 里同时问两件事：

| 子问题 | 类型 | 实际在决定什么 |
| --- | --- | --- |
| `info_selected` / `info_followup`：问的是候选对象吗 | noul | **Local Context**：确认 Vision Pro 给出的候选对象（指着的物体 / 所在区域）是不是这个问题的对象 |
| 每个 context group 一个 noul：需要哪几类用户资料 | noul × 每类 | **Global Context**：从用户资料（weather / storage / user_events / personal）里选 |

两者的结果在 `answerPipeline` 里是**互斥**的（[jev-pipeline.mjs#L289-L293](https://github.com/ziru-wei/intelligent-spatial-interface/blob/d32950e61b3b8a3f421fd2510cd7c0481c1965b2/editor/scripts/jev-pipeline.mjs#L289-L293)）：

```js
const info = infoRoute(catalog, read?.answers, read?.reference);
if (info) { ...; return runInfo({...}); }   // 一旦确认候选对象，直接返回
const {groups, reference} = read;          // 只有没确认时才用到 groups
```

### Problems

1. **Global Context 被整个丢掉。** 确认候选对象之后，`runInfo` 给 Gemini 的 context 只有 `{time, conversation, info}`（[#L197-L224](https://github.com/ziru-wei/intelligent-spatial-interface/blob/d32950e61b3b8a3f421fd2510cd7c0481c1965b2/editor/scripts/jev-pipeline.mjs#L197-L224)）。Jev 已经算出的 groups 被直接丢弃。
   例子：指着糖果问“我在控糖，能吃吗？”，Gemini 看不到 personal 里的饮食偏好。
2. **Spatial UI mod 也被跳过。** Mod 只在 General 路径里选。比如指着窗户（带 info）问“今晚会下雨吗”，确认是窗户以后就不会出天气 UI。
3. **Answer instruction 也强制互斥。** `answerInstruction` 写的是 “If context.info is given … answer only from context.info”（[answer-contract.mjs](https://github.com/ziru-wei/intelligent-spatial-interface/blob/d32950e61b3b8a3f421fd2510cd7c0481c1965b2/editor/scripts/answer-contract.mjs)）。
4. **score 模式下连 Global Context 都不算。** `selection_mode = 'score'` 时整个 `jev_read_request` 跳过（`scoreOnly`），groups 根本没有。
5. **角色不清。** 两个子问题挤在同一个“选 context”的步骤里，读代码和画图时都会让人以为它们是同一个决定。

### Proposed Change

**系统角色上拆成两个独立的决定，工程上仍然可以合并成一次 call。**

| 模块 | 输入 | 决定 | 输出 |
| --- | --- | --- | --- |
| **Local Context** | gaze / 指向 / 触碰 / 位置（Vision Pro）；问题、候选对象名（Jev） | 候选对象是什么；问题是不是在问它 | `local = {key, info}` 或 `null` |
| **Global Context** | 问题、group 简介、对话 | 需要哪几类用户资料 | `groups = [...]`（可以为空） |

两者**组合**而不是二选一：

```text
Gemini context = { time, conversation,
                   info:   local  ? 候选对象的 info : 省略,
                   ...readContext(groups) 如果 groups 非空 }
Spatial UI mod  = 只要 groups 加载了对应数据就照常选（与 local 无关）
```

具体改动：

1. **`answerPipeline` 不再早返回。** 先并行拿到 `local`（`infoRoute` 的结果）和 `groups`，再组一个 context。`runInfo` 里读 info、续接 `previous_interaction_id`、`recordInfo` 的逻辑保留，只是把 groups 的明细一起放进 context。
2. **Mod 的选择不再依赖“走没走 Info”。** `availableMods` 本来就由开关和已加载数据决定，只要去掉对 Info 路径的短路即可。
   - 例子：指着窗户（带 info）问 “Will it rain tonight? Should I close this?”。② 选了 weather。
     - 现在：① 确认是窗户 → 直接走 Info，Gemini 只看到窗户的 info，没有天气数据，也不会出天气 UI。
     - 改后：Gemini 同时拿到窗户的 info 和天气；Mod 看到天气数据已加载 → 选 weather → 出今晚的天气控件。
   - ② 没选任何用户资料时（Candy、Lab），Mod 没有可用候选，不需要调用，结果和现在一样。
3. **改 `answerInstruction`。** 从 “answer only from context.info” 改成：“回答以 `context.info` 描述的对象为主；用户资料只用来做个性化，不要回答成别的对象”。
4. **score 模式下 Global Context 也要算。** 跳过的只应该是 `info_selected` 这一个子问题，groups 仍然要问。
5. **一次 call 还是两次 call。**
   - 默认仍合并为一次 `jev_read_request`，省一次往返延迟。代码里把答案拆成 `local` 和 `global` 两个结构返回，让调用方看不到“同一个 call”这件事。
   - 如果以后 Local 需要更重的输入（比如图片），再拆成两个 call 并行发出。

### Caveats

- **Global 选组可能变吵。** 以前这部分结果被丢掉，现在会被使用，所以在“问的是这个东西”的问题上，Jev 可能会多选一些无关的组。可以在 groups 的 noul 提示里加一句：“如果问题是关于某个具体对象的，只选能补充个人情况的资料”。
- **追问续接要处理资料变化。** 续接上一次 info interaction（`previous_interaction_id`）时，如果这一轮多了 groups，需要把 groups 作为新输入发送，而不是假设 interaction 里已经有了。
- **要回归验证的 example：**

  | Example | 预期 |
  | --- | --- |
  | Candy | 结果不变：groups 为空 |
  | Lab | 结果不变：groups 为空，仍只读 theme 块 |
  | Weather / FindMy | 结果不变：没有候选对象 |
  | 新增：指着糖果 + 饮食偏好 | context 同时包含糖果 info 和 personal |
  | 新增：指着窗户问天气 | 同时出现窗户 info 和天气 UI |

## 2. Multiple Representations in One Response (Future Work)

### Current Behavior

一次请求最多出一个 Spatial UI mod（`jev_call_mod` 在 none / weather / findmy 里选一个），加上 Zone animation（只在 lab）。Weather UI 和 FindMy 的物品高亮不会在同一次回应里同时出现。

### Why It Matters

Draft 的 intro 场景是 “收拾行李时问下周天气、要带什么”：一次请求同时需要可导航的天气 UI 和原地高亮的物品。现在的系统做不到。

### Proposed Change（之后的工作，不在当前改动范围内）

- `jev_call_mod` 从 choice（选一个）改成对每个可用 mod 给 noul 分数，超过阈值的都出。
- 多个 representation 同时出现时，需要决定各自锚在哪里、谁先谁后，避免互相遮挡。
- 部分之间有依赖时，要按顺序处理：比如先得到天气，再据此决定高亮哪些物品（下雨 → 伞）。结果仍然并列呈现。
- **不在 scope 内：** 把各部分之间的联系本身呈现出来，例如把某天的雨、要带的伞和那天的日程连在一起展示。这超出了这个 project，可以作为单独的 project。
- 依赖第 1 条：Mod 的选择先要和 Local Context 解耦。

