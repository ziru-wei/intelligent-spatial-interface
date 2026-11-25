---
created: 2026-11-16
updated: 2026-11-17
---
# ModOS System Design (Rebuild Plan)

目标：在现有的 3D web 平台（digital twin + 物理环境数据）上重建 ModOS，让它支持多个 MOD 组合、用户 authoring，并理顺 context info 和 representation 的路由。这一版的验收标准：**现有参数设计和 pipeline 能实时地为 foundational MOD 组出理想的界面。** Vision Pro 客户端之后接同一套回应格式。

## 0 Decisions So Far

| 日期 | 决定 |
| --- | --- |
| 2026-11-16 | 决策引擎继续用 Jev，只用 choice 和 noul 两种问法。 |
| 2026-11-16 | Primitive representation 是组成 MOD 的 block，由作者决定，用户不能扩展。**用户扩展的是 MOD**：用 primitive representation 组成新的 MOD。 |
| 2026-11-16 | 不做长线 task assistance / task automation，不复现 Guided Reality 一类的分步引导。 |
| 2026-11-16 | memory item 的数据类型由系统固定一小组；primitive representation 只接这些类型。 |
| 2026-11-16 | primitive representation 的参数全部有边界（enum，或从数据里挑）；唯一的生成内容是文字（Gemini）。 |
| 2026-11-16 | MOD 可以把 primitive representation 的参数预先填死或缩小范围。 |
| 2026-11-16 | 多个 MOD 同时出现时，由 Composition 按 primitive representation 的摆放规则统一避让，不交给 Jev。 |
| 2026-11-16 | 术语统一用全称 primitive representation。 |
| 2026-11-16 | 系统按模块设计。Jev 封装成 decision module，之后可以换成或并排比较其他 decision model（6.4 节）。 |
| 2026-11-16 | 外部数据（例如天气）进 cache：用户加入某个 MOD 时就开始缓存它需要的数据，运行时只读 cache，不现取。现阶段 cache 里放 mock 数据，之后再实现真实的获取流程（第 3.5 节）。 |
| 2026-11-16 | 这一版忽略多个 MOD 之间的依赖（例如“下雨 → 带伞”），多个 MOD 只做并列呈现。 |
| 2026-11-16 | “memory” 改称 **context info**：系统为回答所用的、关于空间和用户的信息，不是用户的记忆。 |
| 2026-11-16 | **先选 MOD，再由 MOD 要信息**：选 MOD 只用问题、每个问题关于什么、local context；之后每个 MOD 沿 twin 取它需要的 context info（6.1 节）。不在整个空间里打分。 |
| 2026-11-16 | 一句话按规则切成几个问题；每个问题分别判断“关于什么”、分别给 MOD 打分。 |
| 2026-11-16 | **同一个需求的两种呈现只留一个**（问的是同一件东西，例如 printer 的 ObjectStatus 和 IoTControl）；**一句话里的两个需求都保留**（问的是不同的东西，例如“要不要带伞”的天气和伞的位置）。 |
| 2026-11-16 | Delegate 进入 scope：替用户发送、分享；动作只在用户按下确认后执行。 |
| 2026-11-16 | 面板类的 primitive representation（Data Widget、Control、Action Card）都是空间中的物体：放在相关东西旁边、朝向用户，不平铺在桌上。 |
| 2026-11-17 | 面板由一个**共享的组件库**按数据类型组合，不为某个 MOD 或某台设备画 UI（4.3 节）。设备描述为 **Inputs（可以调的）和 Outputs（可以看的）**，适配任何家用设备（3.7 节）。 |

## 1 Why Rebuild

### 1.1 What Works and Should Be Kept

| 优点 | 现在在哪 | 为什么要保留 |
| --- | --- | --- |
| **有边界的选择** | Jev 只回答 choice / noul；数值和几何由 server 从数据解析（`weather.resolve`、`findmy.resolve`） | 快、一致、可检查，是和 Generative UI 拉开距离的核心论点 |
| **回应分 part 并行交付** | text / ui / animation 各自发布，谁先到谁先显示；Gemini 流式 | 实时性 |
| **空间线索在客户端算** | gaze / 指向 / 触碰打分，区域作为弱候选 | 几何计算不占 LLM 时间 |
| **摆放规则** | 天气贴窗 / 桌 / 墙；info 放在物体旁；FindMy 视野外有箭头 | 是 primitive representation 摆放规则的来源 |
| **Digital twin 和编辑器** | 扫描、`semantic.json` 布局、composition、info 挂载、提问 trace 和回放 | authoring 和调试都建在它上面 |

### 1.2 Limitations

| 问题 | 具体表现 | 根本原因 |
| --- | --- | --- |
| **不能组合** | 一次回应最多一个 Mod；Local 和 Global context 二选一（system-changes 第 1、2 条） | pipeline 按“路径”写，不是按“这次用哪些 MOD” |
| **加 MOD 要改代码** | `availableMods`、`ZONE_ANIMATIONS`、`context.json` 的 groups 都是常量 | MOD 没有自己的数据结构 |
| **Knowledge 混乱** | 天气是外部数据，却放在“用户资料”的 group 里；Weather 能否出 UI 取决于 Jev 是否选中 weather 这个 group | memory 按文件分组，不按“关于什么”；retrieval 和 representation 的资格绑在一起 |
| **Representation 路由混乱** | Lab 的知识分块由“选动画”那次 call 顺便选出，再靠 `part_keys` 特判塞进 info 回答；区域写死 | 动画、知识选择、区域判断混在一个特例里 |
| **Ego 是 Mod** | ego mod 和其他 Mod 竞争，靠可见度仲裁只出一个 | “物体自己说话”本来是一种呈现方式 |
| **用户无法 author** | 只能挂 info key（文字或文件） | 同上：没有 MOD 结构 |

## 2 Design Principles

1. **MOD 是数据，不是代码。** 声明知道什么、属于哪里、可以怎样呈现、什么时候相关；不写控制流。
2. **Primitive representation 是固定的 block，MOD 是可扩展的单位。** Primitive representation 由作者提供；MOD 由 primitive representation 组成，用户通过新建 MOD 来扩展系统。Ego Object 是 primitive representation，不是 MOD。
3. **Context info 按“关于什么”组织。** 每条信息挂在 digital twin 的实体上。
4. **MOD 选择、取 context info、参数填写是独立的步骤**，结果可以组合，没有互斥的路径。
6. **界面由组件库按数据类型组合**，不为某个 MOD、某台设备手画；新 MOD 只要用已有的数据类型就有画面。
5. **每个决定都是有边界的 Jev 选择**，问题由 MOD 和 primitive representation 的声明自动生成。

## 3 Context Info

系统为回答所用的、关于空间和用户的信息（原称 memory；代码在 `scripts/modos_context.py`，API `/api/modos/context`）。

### 3.1 Entities

Digital twin 里的实体：`place`（区域）、`object`（家具、物品、设备、门窗）、`user`、`feed`（外部数据源）。实体来自扫描和语义布局；物品、设备、数据源也可以由 authoring 加入。

### 3.2 Items

每条知识是一个 item：

```json
{
  "id": "lab-theme",
  "about": ["place:lab-2f"],
  "type": "text",
  "summary": "PRL 的研究主题：programmable reality，AR/VR，机器人，可变形界面",
  "body": "…",
  "source": "space-owner",
  "freshness": "static",
  "visibility": "shared"
}
```

### 3.3 Item Types

系统固定的 8 种类型。primitive representation 只接这些类型，所以 MOD 的绑定可以在 authoring 时检查。

| 类型 | 结构 | 例子 | 用到的 foundational MOD |
| --- | --- | --- | --- |
| `text` | 一段文字 | 糖果的说明、lab 的研究主题、办公时间 | WorldInfo、Wayfinding |
| `file` | PDF、图片等 | 说明书、书的内容 | BookCompanion、WorldInfo |
| `steps` | 有序的步骤列表；每一步可以指明身体部位和动作 | 菜谱、咖啡机的用法、拉伸动作 | StepGuide、LiveCoach |
| `timeseries` | 带时间的数据点，可分组 | 天气预报 | Weather |
| `schedule` | 事件列表（时间、地点、标题，可以关联一个物体） | 个人日程、共享空间的活动、“三点提醒我看烤箱” | Agenda、Reminder |
| `item-location` | 物品 → 容器实体 | 耳机在 3 号架子底层 | FindMy |
| `status` | 一个状态值 + 等级（ok / attention / warning） | 牛奶明天过期、植物该浇水 | ObjectStatus |
| `device-state` | 设备的 Inputs（可以调的）和 Outputs（可以看的），按值类型描述，见 3.7 节 | 台灯开 / 关、亮度；打印任务进度 | IoTControl、ObjectStatus |

### 3.4 Migration from the Current Data

| 现在 | 迁移到 |
| --- | --- |
| `context.json` 的 weather group | `feed:weather` 上的 `timeseries` item，不再是用户资料 |
| storage 的 stored_items | 每个物品是 `object` 实体；位置是 `item-location` item |
| user_events、personal | 挂在 `user:me` 上的 `schedule`、`text` items |
| 物体、区域上的 info key | 对应实体上的 `text` / `file` items |
| Lab 的 members / theme / philosophy | `place:lab-2f` 上的三个 `text` items，各有 summary；不再需要 `part_keys` 特判 |
| 对话快照 | 单独的 session memory，不挂在实体上 |

### 3.5 External Data Cache

外部数据（`feed` 实体，例如天气）不在提问时现取：

| 时机 | 做什么 |
| --- | --- |
| **用户加入一个 MOD 时** | 登记这个 MOD 用到的 feed；开始填充它的 cache |
| **后台** | 按 feed 的 `freshness` 定期刷新 cache（例如天气每小时） |
| **提问时** | pipeline 只读 cache；cache 里的数据就是 `timeseries` 等类型的 items |

每个 feed 有一个 **fetcher**，负责把外部数据转换成系统的 item 类型。**现阶段**：fetcher 是 mock，直接写入录制好或手写的数据（例如现在的 `weather.json`）。**之后**：换成真实的获取流程（API、刷新、失败重试），cache 的格式和 pipeline 都不用改。

### 3.6 Digital Twin Organization

**已实现（2026-11-16），见 10.4 节。** 现在的 digital twin 里，实体分散在四处，各自的格式不同：

| 现在在哪 | 内容 | 问题 |
| --- | --- | --- |
| `scan/semantic.json` 的 `rooms` | 区域（多边形），可以挂 info key | 还算清楚 |
| `scan/semantic.json` 的 `objects` | 42 个 box：家具、柜子、架子，**也有海报、小册子** | `category` 是扫描用的几何分类（`storage_cabinet_mid1`、`table_other_rect`、`custom`）；海报这类信息载体也被当成家具；层级藏在 label 里（“shelf 3/bottom shelf”） |
| `scan/semantic.json` 的 `openings` | 门、窗（门带 `destination`） | 还算清楚 |
| `composition.json`（空间级、录制级）+ `components/` | 场景物体，例如糖果 | 另一套 id（`comp:`）和格式 |
| 用户资料里的 `stored_items` | 用户的物品，引用容器的 box id | **物品不在 twin 里**，只是用户资料里的一段文字 |
| 没有 | 联网设备 | IoTControl 无处挂 |

保留现有的源文件（编辑器和扫描流程都依赖它们），在上面加一层统一的**实体视图**（`scripts/modos_twin.py`），所有 ModOS 模块只读这一层：

```json
{
  "id": "layout:lab-shelf-3",
  "kind": "furniture",
  "category": "shelf",
  "traits": ["container", "surface"],
  "parent": null,
  "place": "zone:lab-2f",
  "geometry": {"source": "semantic", "box": "lab-shelf-3"},
  "device": null
}
```

| 字段 | 取值 | 作用 |
| --- | --- | --- |
| `kind` | `place`、`furniture`、`opening`、`item`、`artifact`（海报、小册子、书）、`device` | 把信息载体、物品、设备和家具分开 |
| `category` | 语义分类（shelf、cabinet、desk、lamp…），由几何分类映射，可以手动改 | 给 Jev 和 authoring 看的名字 |
| `traits` | `container`、`surface`、`window`、`display`、`iot` … | **primitive representation 的锚点要求按 trait 匹配**：Highlight 要 `container` 或任意实体；Ambient Effect 要 `surface` 或 `window`；Control 要 `iot` |
| `parent` | 父实体 | 嵌套容器（架子的某一层）不再藏在 label 里 |
| `place` | 所在区域 | 空间筛选（阶段 0） |
| `device` | IoT 设备才有：协议、Inputs、Outputs（3.7 节） | Control 读写；作为 `device-state` item 进入 context info |

**三层，有层级（2026-11-16 定）：**

| 层 | 包括（kind） | 层级规则 |
| --- | --- | --- |
| **Layout** | 区域（`place`） | 区域可以在更大的区域里 |
| **Fixtures** | 墙和天花板（`structure`）、门窗（`opening`）、大件静态家具（`furniture`：柜、架、桌、沙发、冰箱、水槽） | 都属于某个区域；墙、天花板、门窗不能有 parent；家具可以是更大家具的一部分（书架 → 某一层） |
| **Objects** | 物品（`item`）、信息载体（`artifact`）、设备（`device`），可以混在一起 | 在某个区域里；可以在家具或另一个物体里面（架子底层 → 耳机）；不能放进墙、门窗或区域；不能形成循环 |

没有标区域的家具、门窗、墙上的海报，按坐标归到所在的区域；在门口或墙上的，归到 0.8 m 内最近的区域。

**IoT 设备：** 建议用 `traits: ["iot"]` 加 `device` 字段，而不是单独的类别。一盏台灯既是家具（可以被高亮、可以放东西），也是联网设备（可以开关）。

**用户的物品：** 物品变成 twin 里的实体（`kind: item`，`parent` 指向容器），而不是用户资料里的一段文字。FindMy 的 `item-location` 数据就从 twin 读出来，物品也可以像其他实体一样被高亮、被指着提问。

### 3.7 Devices: Inputs and Outputs

**一台设备 = 一组可以调的 Inputs + 一组可以看的 Outputs，每一项都有一个值类型。** 不按设备种类写代码：打印机、灯、洗衣机、空调都用同一小组值类型描述，界面和 Jev 的问题都从值类型来（4.3 节）。值类型对齐现有的智能家居标准（Matter 的 cluster、Home Assistant 的 entity domain），接真实设备时只写一层转换，ModOS 本身看不到厂商细节。

**值类型（Inputs 和 Outputs 共用，组件库也按它们选组件）：**

| 值类型 | 结构 | 作为 Input（可以调） | 作为 Output（可以看） | 例子 |
| --- | --- | --- | --- | --- |
| `toggle` | `{value: on/off}` | 开关 | 状态标记 | 电源、门锁、加湿 |
| `level` | `{value, min, max, step, unit}` | 滑条（带 ± 步进） | 带单位的进度条 / 读数 | 亮度 %、音量、设定温度 °C、风速、墨量 %、纸张数 |
| `choice` | `{value, options[]}` | 分段按钮（≤ 4 项）或列表 | 标记 | 输入源、洗衣程序、空调模式、色温预设 |
| `color` | `{kelvin}` 或 `{hue, saturation}` | 色带 | 色块 | 灯的颜色 |
| `command` | `{commands[], confirm?}` | 按钮；会造成损失的命令要确认（同 Action Card） | — | 开始、暂停、取消任务、出纸 |
| `time` | `{at}` 或 `{duration_s}` | 时间选择 / 倒计时设定 | 倒计时 | 预约开始、定时关机 |
| `reading` | `{value, unit, at}` | — | 读数（有历史时带小曲线） | 室温、湿度、功率 W、水箱余量 |
| `task` | `{title, phase?, phases?, done?, total?, unit?, progress?, remaining_s, started_at}` | 配 `command`（暂停、取消） | 进度：阶段、完成量、剩余时间，**实时走** | 打印任务、洗衣周期（洗 → 漂 → 甩）、洗碗机、烤箱预热、扫地机器人 |
| `queue` | `{items: [{title, total?, unit?}]}` | 之后：调整顺序、取消某项 | 列表（“接下来”） | 打印队列、下载队列 |
| `alert` | `{message, level: attention/warning, since}` | 配 `command`（确认、忽略） | 带语气的标记；同时让 Highlight 着色 | 卡纸、门没关、滤网该换 |
| `media` | `{title, artist?, position_s, duration_s}` | 播放控制（播放 / 暂停 / 下一首） | 正在播放 | 音箱、电视 |

**设备描述（twin 里实体的 `device` 字段）：**

```json
{
  "protocol": "mock",
  "class": "printer",
  "inputs": {
    "power": {"type": "toggle", "value": "on"},
    "job":   {"type": "command", "commands": ["pause", "cancel"], "for": "current_job", "confirm": ["cancel"]}
  },
  "outputs": {
    "current_job": {"type": "task", "title": "Ana's CHI poster", "done": 7, "total": 12, "unit": "pages", "remaining_s": 130},
    "queue":       {"type": "queue", "items": [{"title": "Lab meeting slides", "total": 3, "unit": "pages"}]},
    "paper":       {"type": "level", "value": 60, "min": 0, "max": 250, "unit": "sheets"},
    "toner":       {"type": "level", "value": 35, "min": 0, "max": 100, "unit": "%"},
    "alerts":      {"type": "alert", "items": []}
  }
}
```

**常见家用设备，用同一套类型描述：**

| 设备 | Inputs（可以调的） | Outputs（可以看的） |
| --- | --- | --- |
| 灯 | power `toggle`；brightness `level` %；color `color` | 当前的亮度和颜色 |
| 打印机 | power `toggle`；job `command`（暂停、取消） | current_job `task`（页）；queue `queue`；paper、toner `level`；alerts `alert`（卡纸、缺纸） |
| 洗衣机 | program `choice`（标准、快洗、羊毛）；temperature `choice`；spin `level` rpm；start / pause `command`；delay `time` | cycle `task`（阶段：洗 → 漂 → 甩，剩余时间）；door lock `toggle`；alerts `alert`（洗完、不平衡） |
| 空调 / 温控器 | mode `choice`（制冷、制热、自动）；setpoint `level` °C；fan `level` | room temperature、humidity `reading` |
| 电视 | power `toggle`；input `choice`；volume `level` | 正在播放 `media` |
| 扫地机器人 | start / dock `command`；mode `choice`（吸、拖） | run `task`（清扫面积、剩余时间）；battery `level`；alerts `alert`（卡住） |
| 冰箱 | setpoint `level` °C | temperature `reading`；alerts `alert`（门没关） |
| 烤箱 | mode `choice`；temperature `level`；timer `time`；start `command` | preheat `task`；current temperature `reading` |
| 门锁 | lock `toggle`（开锁需确认） | 状态；alerts `alert`（没锁好） |
| 音箱 | play / pause / next `command`；volume `level` | 正在播放 `media` |

**在 pipeline 里怎么用：**

| 阶段 | 做什么 |
| --- | --- |
| Context info | 每台设备是一个 `device-state` item；summary 由 Outputs 生成（“打印 Ana's CHI poster，7/12 页，约 2 分钟”），并列出有哪些 Inputs |
| Fill（Jev） | 一次 choice：哪台设备、动哪个 Input（或只是看）；值按类型问：`toggle` / `choice` 选值；`level` 选相对动作（调高一点、调低一点、最大、最小，或问题里说的值）；`command` 选命令，需要确认的命令不直接执行 |
| Represent | 面板由组件库按值类型组合（4.3 节）：问题关心的 Output 在最上（问打印进度 → 进度条），其次是相关的 Inputs；被调的那项先显示旧值、再动到新值 |
| ObjectStatus | 设备的 `alert` 和 Outputs 也可以直接生成 `status` item，不用另外写 |

**接真实设备：** `protocol` 换成 `matter` 或 `home-assistant`，由适配层把标准的 cluster / domain 映射到上面的值类型（例：Matter OnOff → `toggle`，LevelControl → `level`，ModeSelect → `choice`，OperationalState → `task`；Home Assistant 的 light、climate、media_player、vacuum、sensor 同理）。现阶段是 `mock`：action 直接改存储的状态，`task` 按时间推进。

**现状：** 已实现的面板（`src/device-panel.mjs`）还是从状态的字段名推断类型（看到 `power`、`brightness`、`total` 等），是这套设计的子集；迁移见 10.7 节。

## 4 Primitive Representations

**Spatial UI 的组成。** 一个 MOD 的空间呈现由四类东西组合而成，spatial cue 只是其中一类：

| 组成 | 是什么 | 来源 | 例子 |
| --- | --- | --- | --- |
| **Assets: Ambient Asset** | 和环境融为一体、由数据驱动的效果（代码里的 primitive 仍叫 `ambient-effect`） | MOD 专有（如 Weather） | 天空、日月、雨雪、雾、地面倒影 |
| **Assets: Scene Asset** | 预制的模型、动画、图片（primitive `scene-asset`） | MOD 或空间主人提供 | Lab 的 diorama |
| **Spatial Cue** | 贴在物体、地面、门上的标记、方向、显示和控件 | 公共库（4.4 节），所有 MOD 共用 | Breathing Box、Slider、Icon Button |
| **Text** | 文字形式：Floating Text、Embedded Text、Object-centric Dialogue（4.4 节） | 公共库，所有 MOD 共用；内容来自 Gemini 写的文字 slot 或数据里的值 | 回答、门牌、草稿、物体说的话 |

公共库 = Spatial Cue + Text 的文字形式。文字形式不是 cue：cue 贴着物体或地面的几何，文字形式承载语言内容。MOD 不应该有专用的控件或文字样式：都从公共库里选。MOD 专有的只有 Assets（Ambient Asset、Scene Asset）。

### 4.1 Primitive Representation Spec

每个 core primitive representation = 一份 spec + 一个渲染器。spec 的格式：

```json
{
  "id": "data-widget",
  "description": "可以操作的数据面板：日期按钮、时间轴、单值、列表",
  "accepts": ["timeseries", "schedule", "steps"],
  "anchors": ["user-reach", "surface:desk", "surface:wall"],
  "params": {
    "layout": {"kind": "derived", "rule": "多天 → day-buttons；一天多个时段 → timeline；一个时刻 → single"}
  },
  "state": {"emits": ["cursor", "playing"]},
  "placement": {"priority": 2}
}
```

参数有四种 kind。前三种对应 Jev 的问法，第四种不问 Jev：

| `kind` | 含义 | 怎么决定 |
| --- | --- | --- |
| `enum` | 在固定值里选一个 | Jev choice |
| `pick-one` | 从数据或实体里挑一个 | Jev choice（选项是数据条目或实体） |
| `pick-many` | 从数据或实体里挑若干个 | Jev 每项一个 noul，≥ 0.5 选中 |
| `derived` | 由已选的数据按规则算出 | 不问 Jev。例：天气控件的布局由选中了几天、几个时段决定（现在代码就是这样做的） |

文字（Situated Text、Object-centric Dialogue）不是参数，由 Gemini 生成。

`state` 声明这个 primitive representation 在客户端产生或接收的交互状态，用于 MOD 内部各部分联动（见 5.2）。

### 4.2 Core Primitive Representations

| Primitive representation | 作用 | `accepts` | `anchors` | 主要 `params` | `state` |
| --- | --- | --- | --- | --- | --- |
| **Highlight** | 高亮物体或容器；嵌套容器带父级淡高亮 | `item-location`、`status`，或实体 | object | `targets`（pick-many）；`tone`（enum 或由 `status` derived） | |
| **Object-centric Dialogue** | 物体以第一人称说话：回答以 bubble 出现在物体上（文字形式，见 4.4；没有动作） | `text` | object | 说话的物体 = referent（规则决定，不是参数） | |
| **Situated Text** | 把回答放在实体旁或表面上；可带指向实体的角标和箭头 | 任意（内容来自 Gemini） | object / surface / 相对另一个部分 / 用户视野 | `link`（是否指向 referent，derived） | |
| **Label** | 短标签、门牌、标注 | `text`、`steps` | object / door / place / user-body | `targets`（pick-many） | |
| **Data Widget** | 可操作的数据面板（由 4.3 节的组件组成）：日期按钮、时间轴、播放 / 暂停、读数、列表 | `timeseries`、`schedule`、`steps` | user-reach / surface / object 旁 | 组件由数据类型决定（derived） | 产生 `cursor`、`playing` |
| **Ambient Effect** | **新增。** 由数据驱动、和环境融为一体的效果：天空、日月、雨雪、光照，合成在窗、墙、桌或天花板上 | `timeseries` | surface | `effect`（derived：由当前条目的天气状况决定） | 接收 `cursor` |
| **Control** | 设备旁的空间面板（由 4.3 节的组件组成）：按设备的 Inputs 和 Outputs（3.7 节）组合开关、滑条、分段按钮、任务进度、队列、按钮 | `device-state` | object（设备）旁，朝向用户 | 设备 + 动作（一次 choice）；组件由值类型决定（derived） | 读写设备状态；任务进度实时走 |
| **Action Card** | **新增。** 替用户做一件涉及别人的事：对谁、带什么、可编辑的草稿（文字 slot）、确认按钮；按下才执行 | `text`、`file`、联系人 | object（要发送的东西）旁，朝向用户；没有时在用户面前 | 收件人、附件（choice） | 草稿可编辑；确认后显示已发送 |
| **Scene Asset** | 播放预制的动画、模型、图片 | 资源文件 | place / surface | `asset`（pick-one，候选由 MOD 给出） | |
| **Guidance** | 目标在视野外时的方向提示；去另一个地点的方向；在身体上指示动作方向的箭头 | 实体、`steps` | 用户视野 / 门 / user-body | `target`（与 MOD 的选择相同，derived） | 接收目标是否在视野内；接收身体姿态 |

和上一版相比：
- **新增 Action Card**（Delegate）。
- **新增 Ambient Effect。** 现在的天气效果（`weather-scene.mjs`、visionOS `WeatherEffect`、`Precipitation`）是一个独立的呈现方式，既不是控件也不是预制资源。teaser 里的 “environment-scale visualization” 也是它。
- **Data Widget 变成可操作的面板**，并且产生 `cursor`，和 Ambient Effect 联动。
- **Situated Text 可带指向 referent 的角标和箭头**（现在 `info-visual.mjs` 的做法）。

### 4.3 Component Library and Component Spec

**问题：** 现在 Weather 的控件是天气专用代码（三种写死的布局），IoT 的面板是另一个文件里的另一套画法；它们都不是“从组件库里挑组件再填文字”。新 MOD（Agenda、StepGuide…）要么没有画面，要么又得画一个。

**做法：** 面板类的 primitive representation（Data Widget、Control、Action Card）不再各自画 UI，而是由一个**共享的组件库**按**数据的值类型**组合。

| 层 | 是什么 | 谁决定 |
| --- | --- | --- |
| 数据 | 带值类型的数据（3.7 节的类型，加上时间序列、日程、步骤、联系人） | context info / 设备描述 |
| 组件选择 | 值类型 → 组件（下表），按规则 | Composition，不问 Jev |
| 排布 | 问题关心的部分在最上；Outputs 在 Inputs 前（问状态时）或后（要调节时）；超过约 6 行时其余折叠为“更多” | Composition，规则 |
| 文字 | 标题、说明、草稿 | 语言模型，填进组件的文字位 |
| 渲染 | 画组件规格 | 每个平台一个渲染器（网页、Vision Pro），**没有某个 MOD 专属的渲染代码** |

**组件（第一版）：**

| 组件 | 接收的值类型 | 交互 | 现在谁在用（迁移后） |
| --- | --- | --- | --- |
| switch | `toggle` | 点按 | IoTControl |
| slider | `level` | 拖动、± 步进 | IoTControl（亮度、音量、设定温度） |
| segments | `choice`（≤ 4 项） / list picker（更多项） | 点选 | IoTControl（输入源、程序） |
| button | `command` | 点按；需要确认的先变成“确认” | IoTControl、Action Card（Send） |
| readout | `reading`、`level`（只读） | — | IoTControl、Weather（温度） |
| progress | `task` | 跟随时间；可带阶段 | IoTControl（打印、洗衣） |
| list | `queue`、`steps`、`schedule` 的条目 | 可滚动；之后可勾选 | IoTControl（队列）、StepGuide、Agenda |
| day selector + timeline | `timeseries`、`schedule` | 选日、拖时间、播放 | Weather、Agenda |
| field | 联系人、附件、短文字 | 点按编辑 | Action Card |
| text block | 语言模型的文字 | 可编辑（草稿） | Action Card、各 MOD 的说明 |
| alert chip | `alert`、`status` | 可确认 | IoTControl、ObjectStatus |

**组件规格（compose 输出，渲染器只画它）：**

```json
{
  "panel": "control",
  "anchor": {"beside": "layout:lab-printer", "face": "user"},
  "title": "printer",
  "status": "working",
  "rows": [
    {"component": "progress", "bind": "outputs.current_job", "emphasis": true},
    {"component": "list",     "bind": "outputs.queue", "max": 1, "label": "Next"},
    {"component": "readout",  "bind": "outputs.paper"},
    {"component": "switch",   "bind": "inputs.power"},
    {"component": "button",   "bind": "inputs.job", "commands": ["cancel"], "confirm": true}
  ],
  "change": {"bind": "inputs.power", "from": "off", "to": "on"}
}
```

同一条路径给所有面板：Weather 的控件 = day selector + timeline + readout（`timeseries`）；Agenda = timeline + list（`schedule`）；StepGuide = list（`steps`）；Delegate 的 Action Card = field + text block + button。**一个新 MOD 只要用已有的值类型，就自动有界面**；需要新的值类型时，加一个组件（作者的工作，和 primitive representation 一样固定），而不是为某个 MOD 画一次。

不是面板的 primitive representation（Highlight、Guidance、Ambient Effect、Scene Asset、Situated Text、Label）保持各自的渲染器：它们是放进场景的效果，不是控件。

**和定位的关系：** 组件库固定（作者提供），运行时只做选择和组合（Jev 选数据，规则选组件，语言模型填文字），处在 vibe coding（写代码）和 generative UI（运行时生成整个界面）之间。

### 4.4 Spatial UI Cues

The components of §4.3 sit on a slab beside the thing and read as a flat panel. Spatial cues take the shape of what they are about instead: its box, its footprint, its edge, a doorway or the floor. Bright cyan (`#3ff0ff`); text is flat and always faces the user. Prototypes: `src/spatial-ui/cues.mjs`; pictures: `context/vocabulary/` and the main page's Vocabulary.

Each cue is defined by when it is used and what it does, in seven groups. The two groups of controls differ in what a change does: **Adjust** cues change the thing itself, and the change is sent to it once the user makes it (a press, or letting go of a drag); **Explore** cues move through information the answer shows (another day, another hour), and nothing is sent, only what is shown changes.

| Group | Cue | When to use it, to do what | Example |
|---|---|---|---|
| Mark | Breathing Box | When the user is looking for a thing or must notice it, to draw the eye to the thing itself. | FindMy found item; ObjectStatus attention |
|  | Corner Brackets | When the thing carries content the user needs to read (a document, book, poster, screen), to mark it without covering that content. | WorldInfo on a poster |
|  | Footprint Ring | When the user is operating or asking about one thing and its controls or info appear beside it, to show which thing they belong to. | IoTControl on the lamp |
|  | Floor Area | When the target is a room or area in view, to show its extent; a place has no box, so only its floor lights up. | LabInfo “this area” |
|  | Doorway Glow | When the target room is elsewhere but its door is in view, to show where to go in. | Wayfinding to a room |
| Direction | Arrow Ahead | When the target is nearby but out of view, to show which way to turn. | FindMy, Wayfinding |
|  | Floor Path | When reaching the target means walking through other spaces, to lead the user along the route. | Wayfinding along a corridor |
| Link | Text Arrow | When text stands apart from the thing it is about (Floating or Embedded Text beside a poster or a bowl), to point from the text to that thing: a bright cyan polyline, a shaft and an open head, flat and turned to the user. It does not lead anywhere; Arrow Ahead and Floor Path are for going somewhere. | WorldInfo beside a poster |
| Visualization | Gauge | When the user asks how much of something there is now (a level with a range: brightness, toner, battery), to show the amount at a glance. | “How bright is the lamp?” |
|  | Progress Rail | When a task is running toward an end, to show how far along it is and how long is left. | Printer job, laundry cycle |
|  | Pinned Tags | When the user needs several separate readings of one thing, to show each next to the part it is about. | Printer toner and paper |
|  | Status Pulse | When something about a thing needs attention, to flag it in the state’s color and say why. | ObjectStatus “paper low” |
|  | Card Stack | When things wait in line for a device, to show what is next and how many are waiting. | Print queue |
| Controls | Slider | When the user wants to change a level, to let them set it by dragging along the thing’s edge; the bar follows the drag and the new level is sent when they let go. | “Make the light brighter” |
|  | Choice | When one of several options is picked (a TV's input, who a message goes to), to pick it where it acts: a few short options (up to 4) stand in a row of capsules, one press; more or longer ones collapse into a dropdown showing the chosen one. A person's option shows their initials. | “Put the TV on HDMI 2”; Send's recipient |
|  | Icon Button | When the user wants to switch something on or off or trigger a command, to do it in one press: a preset icon with its word (Send, Confirm, Cancel, Turn on/off, Pause…). | Power, cancel a print job, Send |
|  | Date Picker | When data is dated and the user can move between days, to pick a day: the month once above, each day a capsule with its weekday and date. | Weather days, Agenda |
|  | Playback | When data runs through time, to play it and scrub to a moment: a Play/Pause button, a rail with a stop per entry, and the current time riding on the thumb. | Weather hours |
|  | Text Input | When the user may change what will be said before it is sent, to show the drafted text in a field they tap to edit (keyboard or dictation); the text changes in place. | Send's draft |
|  | AR Photo | When what is sent is a photo of a thing, to show the photo about to be sent (the camera frame cropped to the thing), in the message. | “take a pic of this, send it to Alice” |

**Controls are grouped by component, not by what a press does.** Whether a control's value is sent on change (a device's Slider or Choice), on Send (a message's Choice of recipient, its Text Input) or never (Date Picker, Playback moving through information) is how a MOD uses it, as in A2UI, where inputs stay local until an action fires. The earlier Adjust / Explore / Interactive rows are gone, and with them Edge Tabs and Contact Chip (now Choice), Tether Send and Photo Capture (removed: the thing that goes with a message is marked with the library's Mark, Corner Brackets on something with content, else Breathing Box) and the photo card (now AR Photo).

**Sending (the Send MOD, formerly Delegate).** A message is composed from library parts, none of them Send's own: a Choice of who it goes to (the best match chosen; the other contacts in its dropdown), the draft in a Text Input, an AR Photo when a photo goes with it, the Send preset button, and the attached thing marked. They stand as one column beside the thing (`src/beside.mjs`); with nothing attached, in front of the user. What goes with the message is a choice in Fill (Send's `capture` selector: the thing, a photo of it, or nothing).

**Text forms (library, not cues).** Every MOD's language goes through one of three forms; a slot declares which (`floatingText`, `embeddedText`, `dialogue` in its `ui`):

| Form | When to use it, to do what | Example |
|---|---|---|
| Embedded Text | When the UI library's Write on surfaces is on (off by default) and a surface at the anchor scores well for writing on (`surface.score` ≥ 0.5: the text-surface placement's score from legibility, size and clutter), to write the text onto it, handwritten, so it becomes part of the room | Weather's answer on the desk, LabInfo on the wall |
| Floating Text | By default (Write on surfaces off), and when no surface scores well enough (`surface.score` < 0.5), to show the text fixed to the user's view: centred, just above the question's caption (never covering it), leaning back a little toward the eye | an answer beside the lamp, a door's name, Delegate's draft |
| Object-centric Dialogue | Only when a thing is clearly pointed at (`target.pointed`) and the user speaks to it in the second person (`request.second_person`: "what are you?"), to let the thing answer in its own voice from where it is | WorldInfo's voice: "Can I eat you?" to the candy bowl |

Situated-text slots declare `fixed: [floatingText]` with `embeddedText` `instead_of` it when `surface.score>=0.5`. Ego-object slots declare `dialogue` (and its motion) only `when: target.pointed & request.second_person`; otherwise the answer falls back to text. "Can I eat this?" is asked *about* the bowl, so it is answered in text.

**Choosing a cue: the MOD declares it.** Each MOD says, on each of its slots, which spatial UI it draws (`ui`, §5.1). At runtime nothing is chosen from the whole library; only the few parts the MOD allows are considered, and by rules:
- `fixed`: always drawn when the slot is shown.
- `flexible`: each drawn when its `when` holds. `when` is a rule over facts computed without a model — the target (`target.has_content` (the thing's `content` trait), `target.other_room`, `target.door_in_view`, `user.in_target`), the data (`data.days`, `data.steps_per_day`, `value.type`, `state.level`), the request (`intent` read / change, `question.about`) and the button presets (`preset.found`). A flexible part may stand `instead_of` a fixed one (FindMy draws Corner Brackets instead of the box when the thing has content to read).
- Anything the MOD does not list is never drawn by it.

The decision model keeps choosing MODs and filling slots (which thing, which device, which action); it does not choose the UI. It is asked about the UI only when a `when` depends on the intent and the intent is unclear, and then only among the MOD's own options. Once a part is drawn in a conversation it stays for follow-ups while its `when` still holds, so the UI does not flicker.

Rules shared across MODs (used inside their declarations):
- Mark: a place gets Floor Area, or Doorway Glow when it is another room. A thing with content to read gets Corner Brackets. A thing to find or notice gets Breathing Box. A thing being operated gets Footprint Ring.
- Direction: Arrow Ahead when the target is out of view; Floor Path when the route crosses spaces.
- Visualization or Control (IoTControl's flexible list) follows the value type (§3.7) and whether the request reads or changes it:

| Value type | Read (an output, or only asked about) | Change (an input the request means to change) |
|---|---|---|
| level | Gauge | Slider |
| toggle | Icon state | Icon Button |
| choice | Tag | Choice |
| command | — | Icon Button |
| task | Progress Rail | Icon Button (cancel, pause) |
| queue | Card Stack | — |
| reading | Pinned Tags | — |
| alert | Status Pulse | — |

**Buttons.** Icon Buttons come from a preset list (`modos/buttons.json`: Send, Confirm, Cancel, Turn on, Turn off, Start, Pause, Resume, Stop, Next, Back, Retry, Open, Call), each an icon and its word. An action is matched to a preset by rule first (its op, e.g. `set power false` → Turn off; Delegate's send → Send). If no rule matches, Fill chooses among the preset labels with a "none" option. If none fits, the system writes a short text-only button (Text Button), e.g. "Clean print head". Every clickable (buttons, tabs) is a capsule; text on a cyan fill has no shadow or outline; a button sits centred above its thing and faces the user.

Text that does not come from data or a decision (for example "waiting for you") is not part of a representation.

**Weather 的控件改用公共库。** 现在 Weather 的控件是专用的（`src/weather-preview.mjs`）。库里补了两个时间类的 cue，Weather 和其他带日期或时间的数据（Agenda、打印队列）都用它们：

| Weather 现在 | 公共库 |
| --- | --- |
| 日期按钮（月 + 日） | Date Picker：月份在上方写一次，每天一个胶囊（星期 + 日期） |
| 播放 / 暂停 + 时间横条 + 跟着滑块的时间 | Playback：Play/Pause 按钮、每个时间点一个档位的横条、滑块上方显示当前时间 |

选择规则：`timeseries` 跨多天 → Date Picker；同一天内有多个时间点 → Playback；两者都有就都出现。


### 4.5 Placement: How the Parts Go Together

每个库部件（cue、文字形式、消息组件）自带一个**锚定类**；MOD 只声明画哪些部件，放在哪里由 placement 按锚定类和规则决定。

| 锚定类 | 是什么 | 部件 | 怎么放 | 尺寸 |
| --- | --- | --- | --- | --- |
| **Object-anchored** | 贴在一个东西自己的几何上 | Breathing Box、Corner Brackets、Footprint Ring、Status Pulse、Pinned Tags、Slider、Choice、Progress Rail、Card Stack、Icon Button（设备上） | 占这个东西上的一个 **site**：surround（box、brackets）、footprint（ring）、top（rail、按钮、status）、right（tags、slider）、bottom（tabs）、left（card stack） | 随距离放大，保持可读（k = 距离 / 1.1 m，1–2.4） |
| **Environment-embedded** | 嵌在房间的几何上 | Floor Area、Floor Path、Doorway Glow、Ambient Effect、Embedded Text | 在 twin 的地面、门、墙、窗、桌面上，按真实尺寸；不移动 | 真实尺寸 |
| **Generic UI** | 不依附几何的内容 | Floating Text、消息列（Choice、Text Input、照片卡、Send）、Date Picker、Playback、Arrow Ahead | 三种锚：**beside** 一个东西（旁边、整组在视野内）、**relative** 另一个部件（如回答下方）、**user**（视野内 / 手边）；没有可锚的东西时 float 在用户前方 | 保持视角大小 |

规则：

1. **site 分配（同一个东西上）。** 每个 object-anchored 部件有首选 site（来自库，不来自 MOD）。同一 site 上的部件按顺序叠起来（top：status → progress → 按钮，自下而上，间距随 k）。首选 site 被占时让到下一个 site（right → left）。Pinned Tags 的引线从右侧一个共同的点出发，再分到每个读数。
2. **Generic UI 成组。** 一个 MOD 的 generic 部件（它的文字和控件，或一列消息）是一个 **cluster**，整体放置。候选位置按以下顺序筛选：整组在视野内 → 不盖住目标（目标 `has_content` 时尤其不能挡）→ 不和 object-anchored 部件、environment-embedded 部件、其他 cluster 重叠 → 舒适距离（0.6–1.5 m）→ 朝向用户。都不满足时退到 user 锚（视野内下方）。
3. **Environment-embedded 优先。** 它们不动；其他部件避开它们（文字不压在门框发光上、不压在地面路径上）。
4. **多个 MOD。** 每个 MOD 一个 cluster；分数高的先选位置。指向同一个东西的 object-anchored 部件共用这个东西的 site 分配。
5. **稳定。** 回答到达时，用提问那一刻的相机计算一次，之后锁在世界里。只有整组离开视野一段时间，或用户走远时才重新放置；Arrow Ahead 和 Floor Path 是例外，它们跟着用户。
6. **View stack：不在眼前实物上的 UI 固定在视野里。** 一个回答的 UI 如果没有附着在用户眼前的一个真实东西上，就固定在用户眼前（完全跟随相机，每帧重放），居中，放在文字回答上方，互不重叠。自下而上：问题字幕 → Floating Text → 这些 UI（多个时依次往上叠）。文字不是 Floating（Embedded Text、Object-centric Dialogue）时，它们直接站在问题字幕上方。两种情况：(a) UI 不属于任何实物，比如 Weather 的 Date Picker 和 Playback（天气不是房间里的东西，锚 `user-view`）；(b) 东西存在，但提问那一刻不在画面里（身后的台灯），它的控件进入 view stack，并在这个回答期间一直留在眼前。`src/cluster-placement.mjs`（`viewAnchor`、`STACK`），`agent.viewTop` 给出栈底。

现状：object-anchored 的 site 目前写在各个 cue 里，`src/device-cues.mjs` 只对设备做了 top 叠放和按钮排成一行；cluster 的放置用 `src/beside.mjs`（只检查视野，不检查遮挡和重叠）；回答文字仍走原来的 text surface 放置。还缺一个统一的 placement 模块：site 分配器加 cluster 求解。

## 5 MODs

Primitive representation 是固定的 block；**用户扩展的是 MOD**。新建一个 MOD 时，用户：

1. **选 primitive representation，组成 MOD 的几个部分（slot）**，并说明各部分放在哪里、彼此怎么对齐。
2. **接内容和数据：** 给 Scene Asset 放资源；给 Data Widget 接一份数据；引用实体上的 items。
3. **限定参数：** 把参数填死（`fixed`）或缩小范围（`allowed`）。

### 5.1 Format

一个 MOD 有两层：**MOD 级的选择（selectors）** 和 **内部的组成（slots）**；**variants** 是作者给出的几种 slot 组合（用户可以切换，见第 7 节）。实际文件在 `editor/modos/mods/*.json`。

```json
{
  "id": "weather",
  "name": "Weather",
  "description": "Weather forecasts: whether it will rain, the temperature, wind, and whether to bring an umbrella or a jacket.",
  "examples": ["Will it rain tonight?", "What's the weather this weekend?"],
  "scope": "global",
  "knowledge": [{"ref": "feed:weather", "type": "timeseries"}],
  "selectors": {"entries": {"kind": "pick-many", "from": "feed:weather", "unit": ["day", "period"]}},
  "slots": [
    {"id": "sky",      "use": "ambient-effect", "data": "entries", "anchor": {"order": ["surface:window", "surface:desk", "surface:wall", "surface:ceiling"]},
     "ui": {"fixed": ["ambient:weather"]}},
    {"id": "controls", "use": "data-widget",    "data": "entries", "anchor": {"kind": "user-reach"},
     "ui": {"flexible": [{"cue": "datePicker", "when": "data.days>1"}, {"cue": "playback", "when": "data.steps_per_day>1"}]}},
    {"id": "answer",   "use": "situated-text",  "anchor": {"kind": "relative", "to": "sky", "side": "below"}}
  ],
  "variants": {
    "full":     {"label": "Sky and controls", "slots": ["sky", "controls", "answer"], "text": "answer"},
    "controls": {"label": "Controls only",    "slots": ["controls", "answer"],        "text": "answer"},
    "text":     {"label": "Text only",        "slots": ["answer"],                    "text": "answer"}
  },
  "default_variant": "full",
  "provider": "service"
}
```

空间主人的 MOD 可以**扩展**一个 foundational MOD（`extends`：slots、selectors、variants 按 id 合并，其他字段覆盖）。LabInfo = WorldInfo + lab 的 diorama：

```json
{
  "id": "labinfo", "extends": "worldinfo", "name": "LabInfo",
  "scope": ["zone:lab-2f", "zone:lab-hall-2f"],
  "knowledge": [{"ref": "about:zone:lab-2f"}],
  "selectors": {"asset": {"kind": "pick-one", "from": "allowed", "allowed": [
    {"id": "labResearchWork", "description": "研究内容与 vision"},
    {"id": "labResearchLife", "description": "lab 生活、要求、怎么做研究"},
    {"id": "none", "description": "事实类问题，文字就够"}]}},
  "slots": [
    {"id": "diorama", "use": "scene-asset", "data": "asset", "anchor": {"kind": "place", "of": "zone:lab-2f"}},
    {"id": "answer",  "use": "situated-text", "anchor": {"kind": "relative", "to": "diorama", "side": "beside"}}
  ],
  "variants": {"diorama": {"slots": ["diorama", "answer"], "text": "answer"}, "text": {"slots": ["answer"], "text": "answer"}},
  "default_variant": "diorama", "provider": "space-owner"
}
```

`knowledge` 是这个 MOD 要的 context info（6.1 节第 3 步）：`ref` 指定 item（`feed:weather`、`user:contacts`）、某实体上的信息（`about:<entity>`）或被指着的东西（`referent`）；只有 `type` 时，按类型从它的问题所关于的地方取（例如 IoTControl 的 `device-state`）。

`ui`：这个 slot 画什么（4.4 节）。`fixed` 总是画；`flexible` 每项带一条 `when` 规则，成立时才画，可以用 `instead_of` 替换一个 fixed 的部分；没列出的都不会画。部分可以是库里的 cue、`iconButton:<preset>`，或 MOD 自己的 `ambient:`、`asset:`、`text:` 部分。规则和名称在注册时检查（`scripts/modos_registry.py`）。各 MOD 的声明：

| MOD | slot | fixed | flexible（when） |
| --- | --- | --- | --- |
| Weather | sky | ambient:weather | |
| | controls | | datePicker（data.days>1），playback（data.steps_per_day>1） |
| FindMy | container | breathingBox | cornerBrackets 替换 box（target.has_content） |
| | direction | | arrowAhead（target.out_of_view & !target.other_room：同一房间），floorPath（target.other_room：跨房间）——二选一 |
| Wayfinding | door | | doorwayGlow（门在视野内，用户不在目标房间），floorArea（user.in_target） |
| | direction | | arrowAhead，floorPath（同 FindMy） |
| | sign | floatingText（门牌） | |
| ObjectStatus | state | statusPulse | breathingBox（state.level≠ok），pinnedTags（value.type=reading） |
| IoTControl | device | footprintRing | |
| | controls | | gauge / slider / choice / iconButton / textButton / progressRail / cardStack / pinnedTags / statusPulse，按 value type 和 intent |
| Send | card | choice，textInput，iconButton:send | cornerBrackets / breathingBox（attachment.kind=thing\|photo，按 target.has_content），arPhoto（attachment.kind=photo） |
| WorldInfo | answer | floatingText | dialogue（target.pointed & request.second_person，替换 floatingText、embeddedText、textArrow），embeddedText（surface.score≥0.5），textArrow（text.apart） |
| LabInfo | diorama | asset:diorama | floorArea（question.about=here） |
| Agenda（spec） | timeline | floatingText（列表） | datePicker（data.days>1） |
| BookCompanion（spec） | answer | cornerBrackets | |
| StepGuide（spec） | steps | progressRail，iconButton:back，iconButton:next | |
| LiveCoach（spec） | arrows / labels | bodyArrow（库里还没有），floatingText | |
| Reminder（spec） | target | breathingBox | |

`scope`：`global`，或一组地点 / 物体（用户在那里，或问题指向它时才有资格被选）。

### 5.2 Internal Composition of a MOD

以 Weather 为例，一个 MOD 内部有资源、文字、UI 组件，系统分四层处理：

| 层 | Weather 里是什么 | 谁决定 | 什么时候 |
| --- | --- | --- | --- |
| **数据选择**（selectors） | 选哪几天、哪些时段 | Jev（阶段 3b），**只问一次**，所有 slot 共用 | 每次提问 |
| **slot 参数** | 控件布局、天气效果的种类 | 大多是 `derived` 或 MOD 里填死，基本不问 Jev | 每次提问，由规则算出 |
| **内部摆放** | 效果贴窗；控件在手边；文字在效果下方 | MOD 的 `anchor` 规则：先放主 slot，其他 slot 相对它摆放 | Composition（阶段 4） |
| **交互状态**（state） | 切换日期、拖时间轴、播放 / 暂停时，天气效果跟着变 | 客户端的 MOD runtime：Data Widget 改 `cursor`，Ambient Effect 读 `cursor` | 回应出现之后，**不再经过 pipeline** |

资源（日月、雨雪的 shader）属于 Ambient Effect 的渲染器，不需要 MOD 提供。需要自带资源的是 Scene Asset，例如 Lab 的动画。

**文字放在哪：** 一次回应只有一段生成的文字，它是某个 MOD 的文字 slot。承载文字的 MOD：先是替用户做事的 MOD（Delegate：文字是草稿），其次是和 referent 有关的 MOD，再次是得分最高的；没有 MOD 时放在用户视野里。文字常常比 MOD 先到，先出现在用户视野里，MOD 到达后再移进它的文字 slot。现在的系统已经是这样做的（天气的文字会移到窗户下方）。

### 5.3 What Each Foundational MOD Looks Like

| MOD | Knowledge | Slots（primitive representation → 放在哪） | Jev 要选的 | Derived |
| --- | --- | --- | --- | --- |
| **Weather** ✓ | `timeseries` | Ambient Effect → 窗 / 桌 / 墙 / 天花板；Data Widget → 手边；Situated Text → 效果下方 | 哪几天、哪些时段 | 控件布局、效果种类 |
| **FindMy** ✓ | `item-location` | Highlight → 物品所在的容器（带父级）；Guidance → 容器不在视野内时；Situated Text → 用户视野 | 哪件物品（或 not found / ambiguous）；也负责“要带上的东西”（伞） | Guidance 的目标 |
| **Wayfinding** ✓ | 关于整层楼的说明（关于 ≥ 2 个地点的 item） | Highlight → 目标房间的门；Label → 门牌；Guidance → 门不在视野内时；Situated Text → 用户视野，从当前位置给路线 | 目标地点 | 门 = 该地点边界上离用户最近的门 |
| **WorldInfo** ✓ | 物体 / 地点上的 `text`、`file` | Situated Text → referent 旁，带角标和 Text Arrow；被指着并以第二人称问时为 Object-centric Dialogue（物体上的 bubble） | 规则决定，没有可选项 | |
| **BookCompanion** | 书的 `file` | Situated Text → 书旁，带角标 | 无（读到哪一页仍待定，见第 9 节） | |
| **StepGuide** | `steps` | Data Widget（list）→ 设备旁的表面；Situated Text → 列表旁 | 哪份步骤；显示哪几步 | 布局固定为 list；**一次性列出，不追踪进度** |
| **ObjectStatus** ✓ | 这里的 `status` | Highlight → 相关物体，用 tone 表示状态；Situated Text | 哪些物体（每个一个 noul） | tone 由状态等级算出 |
| **Agenda** | `schedule` | Data Widget（timeline / list）→ 墙或桌；Situated Text → 面板旁 | 哪些事件 | 布局 |
| **IoTControl** ✓ | 这里的 `device-state`（3.7 节） | Highlight → 设备；Control → 设备旁的空间面板；Situated Text → 面板旁 | 哪台设备 + 动作（一次 choice） | 面板组件由值类型决定（4.3 节） |
| **LabInfo** ✓（空间主人的 MOD，extends WorldInfo） | `zone:lab-2f` 的 items | Scene Asset → lab 中间的桌子（不在视野内时：用户前方偏右下）；Situated Text → 动画旁 | 哪段动画（或 none） | |
| **LiveCoach** | `steps`（每一步可以指明身体部位和动作方向） | Guidance → 用户身体上的箭头；Label → 身体上的文字标注；Situated Text → 用户视野 | 哪套动作；当前显示哪几步 | 箭头方向由步骤和身体姿态算出 |
| **Reminder** | `schedule`（时间 + 关于哪个物体 + 说明） | Highlight → 那个物体；Situated Text → 物体旁 | 无（由时间触发，见 6.1 的 Trigger） | tone 由紧急程度算出 |
| **Delegate** ✓ | 用户的联系人 + 被指着的东西 + 周围东西的说明 | Action Card → 附件旁：收件人、附件、草稿、Send | 收件人、附件（choice）；草稿是文字 slot | 按 Send 才执行 |

✓ = 已实现，有自己的画面（10.5–10.7 节）；其余是 spec：能被选中，用文字回答，画面待做（迁到 4.3 节的组件库后，Agenda、StepGuide 可以直接得到画面）。

**覆盖情况：** 10 种 primitive representation（加上 Action Card）能组出上面所有 MOD。

现有的两个例子都变成了普通的 MOD 实例：

- **Candy** = WorldInfo + 挂在糖果上的 `text` item。
- **LabInfo** = 空间主人扩展 WorldInfo 的 MOD（5.1 的例子）。它的信息由第 3 步按 `knowledge` 取（lab 上的三条），不再由“选动画”那次 call 顺便选。

### 5.4 Response Settings Become Authoring

现在 web 编辑器侧栏和 Vision Pro 设置里控制回应的开关，在 ModOS 里分到三个地方：

| 现在的设置 | 归到哪里 | 为什么 |
| --- | --- | --- |
| 每个 mod 的 Text response 开 / 关 | **MOD authoring**：MOD 有没有 `text` slot | 文字由 Situated Text 呈现，它本身就是一个 primitive representation；选中的 MOD 都没有文字 slot 时，回应就没有文字（已实现）。没有任何 MOD 时，文字就是整个回应 |
| Weather 的 Lock location | **MOD authoring**：Ambient Effect slot 的锚点参数（第一次放下后固定） | 是这个 slot 的行为 |
| FindMy 的 Remove on hand approach、距离 | **Removed (2026-11-17)**: an overfit, MOD-specific feature; no dismissal by hands | 同上 |
| Object mod 的 Remove on hand touch | **Removed (2026-11-17)**: an overfit, MOD-specific feature; no dismissal by hands | 同上 |
| Hide after 5 s | **MOD authoring**：slot 的显示时长（默认不自动消失） | 同上 |
| Weather mod / FindMy mod 开关 | **安装**：MOD 装没装 | 已由 `installed.json` 取代 |
| When no surface fits、Placement stability、写字速度、字号、occlusion | **Primitive representation 的默认值**（渲染器参数），作者统一定 | 是渲染方式，不是某个 MOD 的选择 |
| Selection 由 Jev 判断 / 只看分数 | **系统配置**（Grounding 模块的实验条件） | 用于比较，不是用户的选择 |
| Resume on first response、Fixed text response | **编辑器工具**（回放和调试） | 只和录制回放有关 |

## 6 Pipeline

### 6.1 Stages and Jev Questions

先用最少的信息选 MOD，再由选中的 MOD 去要它需要的 context info（不再先在整个空间里 retrieval）。

| 阶段 | 什么时候跑 | Jev 问题（自动生成） | 输出 |
| --- | --- | --- | --- |
| **Trigger**（两种入口） | 用户提问；或者到了某个 `schedule` 的时间（Reminder） | 不调用 Jev。时间触发时生成一个系统请求：referent 是那个物体 | 一个请求 |
| **0 Rules** | 提问时 | 不调用 Jev。按 `scope` 筛出能用的 MOD；地点 MOD 预先开始 Fill。录制里的位置由相机位姿算出（在哪、隔着哪扇门窗面对哪里） | 可问的 MOD |
| **1 Request** | 一次 call | 规则把请求切成几个问题（"?"、"；"、"and + 新问句"，最多 3 个）。每个问题一个 choice：关于什么（看着的东西 / 这里 / 用户 / 外部数据 / 别的）；每个问题 × 每个 MOD 一个 noul；同一次 call 里还有 grounding 的 noul（是否在问看着的东西） | `referent`；每个问题关于什么、各 MOD 的分数 |
| **2 MOD Selection** | 规则 | 不调用 Jev。任一问题对某 MOD ≥ 0.5 就选中；问题关于看着的东西时自动选 WorldInfo（除非地点 MOD 已代表它） | 选中的 MOD（可以多个），各自对应哪些问题 |
| **3 Context Info** | 规则 | 不调用 Jev。每个 MOD 按自己的 `knowledge` 沿 twin 取：指定 item（feed、物品位置）、某实体上的信息（LabInfo：lab）、referent 及其所在（物体 → 家具 → 房间）、或按类型从它的问题所关于的节点取。每个 MOD 最多 6 条。没有 MOD 时，从问题所关于的节点取 | 每个 MOD 的 context info；文字读的是它们的并集 |
| **4 Fill** | 每个选中的 MOD 一次 call，并行 | 由 MOD 的 `selectors` 和各 slot 中未定死的参数生成：enum / pick-one → choice；pick-many → 每项一个 noul。文字 slot 由语言模型写，第 3 步一结束就开始 | 每个 MOD 的选择；文字 |
| **5 Represent** | 部件准备好就交付 | 不调用 Jev。选择 → 画面部件；谁先准备好先显示谁 | 每个 MOD 的部件；文字流式进入文字 slot |
| **（之后）Interaction** | 回应出现之后 | 不调用 Jev | 客户端的 MOD runtime 处理 `state` |

**选 MOD 只用：问题本身、每个问题关于什么、local context（在哪、面对哪里、看着什么）。** 不先读整个空间的信息，也不把「MOD 能不能用」放进模型输入（那是规则）。

### 6.2 Real-Time Budget

```text
关键路径：  [1 Request（含 grounding）] → [4 Fill 各 MOD 并行]
文字：      第 3 步（规则）结束就开始，与 4 并行
```

- 第 2、3 步是规则，几乎不花时间；关键路径上只有两层 Jev。
- 地点 MOD 的 Fill 在第 1 步之前就发出，用不上就丢弃。
- 输入大小：第 1 步的问题数 = 问题数 × 可问 MOD 数（11 个 MOD、3 个问题以内仍在 Jev 限制内）；context info 每个 MOD 最多 6 条。
- atlas 实测（LabInfo）：第 1 步约 240–350 ms，动画在约 0.4 s 出现；文字时间取决于语言模型（正常约 2 s）。

### 6.3 Walkthroughs

| 例子 | 1 关于什么 | 3 Context info | 2 选中的 MOD | 4 填写 | 呈现 |
| --- | --- | --- | --- | --- | --- |
| “周末天气怎么样？” | 外部数据 | weather timeseries | Weather | 周六、周日（布局 derived 为 day-buttons） | Ambient Effect 贴窗；控件在手边；文字在效果下方 |
| “我的耳机在哪？” | 用户 | 用户的物品位置 | FindMy | 耳机 | Highlight 架子；视野外 Guidance + 文字 |
| “这个能吃吗？”（指着糖果） | 看着的东西（糖果） | 糖果的 text，及其所在 | WorldInfo | 说话的物体 = 糖果；grow；neutral | Ego Object 或 Situated Text |
| “这个 lab 做什么？”（在 lab 里） | 这里（lab） | lab 上的 3 条 | LabInfo（已预先填写） | asset = labResearchWork | Scene Asset 在 lab 桌上 + 文字 |
| “今晚会下雨吗？要关窗吗？”（指着窗） | 两个问题：外部数据；看着的东西 | weather；窗户的 text | WorldInfo、Weather | 今晚（布局 derived 为 single） | Ambient Effect 贴在这扇窗上；文字由 Weather 承载（与 referent 有关） |
| “下周天气怎样、要带什么？”（收拾行李） | 两个问题：外部数据；用户 | weather；物品位置 | Weather、FindMy | 下周各天；伞、外套等 | Weather 的三个 slot + 多个 Highlight，由 Composition 避让 |

### 6.4 Decision Module

所有有边界的选择都经过一个 decision module，pipeline 不直接调用 Jev：

```text
decide.choose(stage, question, options[{id, description}], context) → {id, probability, confidence}
decide.score (stage, question, options[{id, description}], context) → {id: 0–1}
```

- **现在的实现：** Jev（TypeSafe API），一次 call 可以带多个 choose / score 问题，和现在的 `createJev` 一样批量发送。
- **可替换：** 其他 decision model 只要实现这两个方法就能接入，例如通用 LLM 加结构化输出。
- **可比较：** 每次决定都记录输入、选项、结果和延迟，可以对同一组请求用不同的 decision model 回放、比较。
- 约束（Jev）：输入上限约 32k tokens，一次 choice 最多 253 个选项。

## 7 Authoring

用户在 3D web 平台的 digital twin 里扩展系统。用户不从零写 MOD，而是在模块化的 MOD 上修改（tailoring）：

1. **挂知识：** 选中实体，加一条 item（选类型、写 summary、填内容或上传文件）。
2. **改 MOD：** MOD 的作者定义能改什么，用户在其中选：
   - **呈现变体（variant）：** MOD 作者给出几种 slot 组合，例如 Weather 的 "Sky and controls" / "Controls only" / "Text only"，WorldInfo 的 "Text beside it" / "The thing speaks"。变体也决定文字放在哪个 slot（situated text 或 ego object）。
   - **设置（setting）：** primitive representation 中 kind 为 `setting` 的参数，作者改一次，运行时不再问，例如文字停留多久、highlight 何时消失、天空是否跟随控件。作者留空（`allowed` 多于一个）的 `enum` 参数也可以在这里定死，否则每次回答由 Jev 选。
   - **文字开关、适用范围（scope）、额外知识、额外示例问题。** 额外知识只在 MOD 被选中时给文字读，不作为 MOD 是否可用的条件。
3. **复制（fork）：** 从一个 MOD 复制出新 MOD，带上当前的修改，再单独修改，例如只在卧室用的 "Weather (bedroom)"。基础 MOD 可以 reset 回作者的版本，复制出的 MOD 可以删除。
4. **测试：** 在 twin 里提问，看回应和每一步 Jev 的选择（复用现有的 trace 和回放）。

存储分三层：基础 MOD（`modos/mods/*.json`）、空间的覆盖（`spaces/<space>/modos/custom.json` 的 `overrides`）和复制（同文件的 `forks`）。Registry 把三层合成 pipeline 读的 effective MOD：只含当前变体的 slot，`text` 指向文字 slot，定下的参数写成 `{fixed}`。每次修改先合成并校验，通过才保存。

和 trigger-action authoring 的区别：作者不写“什么时候、怎么回应”，只声明知识、呈现和相关性；什么时候用、怎么组合由 pipeline 决定。具体界面由 formative study 的 FQ3 决定。

## 8 Platform and Migration

### 8.1 Where Things Live

| 部分 | 现在 | 重建后 |
| --- | --- | --- |
| Digital twin、布局、录制 | `editor/`（three.js web） | 保留 |
| Context info | `context.json`、`info/context.json`、stored_items | 统一的 items，按实体索引（`scripts/modos_context.py`） |
| MOD | 写死在 `jev-pipeline.mjs`、`server.py` | MOD registry（JSON） |
| Primitive representation | web（`weather-*.mjs`、`findmy.mjs`、`ego.mjs`）和 Vision Pro 各自实现 | primitive representation registry（spec）+ 各端渲染器；面板类由共享的空间组件库组合（4.3 节） |
| Pipeline | `answerPipeline` | 按第 6 节重写；保留 `streamAnswer` 和 part 发布 |
| Decision module | `createJev` 直接被 pipeline 调用 | decision module 接口 + Jev 实现（6.4 节） |
| 外部数据 | `weather.json` 放在用户资料里 | feed cache + mock fetcher（3.5 节） |
| Authoring | info 挂载、composition 编辑 | 扩展成 item 和 MOD 编辑器 |

### 8.2 Milestones

1. **数据格式：** items、primitive representation spec、MOD 的 JSON 定下来；把 Weather、FindMy、Lab、Candy 迁移过去。
2. **Pipeline：** 第 6 节的阶段在 web 平台上跑通，先复现第 6.3 节的前五个例子，再做收拾行李的例子。测端到端延迟。
3. **Primitive representation：** web 上先做已有雏形的 6 个（Highlight、Ego Object、Situated Text、Data Widget、Ambient Effect、Scene Asset），再做 Label、Control、Guidance；同时做客户端的 MOD runtime（slot 摆放和 `state` 联动）。
4. **Foundational MOD：** 按 5.2 节补齐。
5. **Authoring 界面**，以及 Vision Pro 客户端接入。

## 9 Open Decisions

- [ ] 真实的外部数据获取流程（第 3.5 节）：数据源、刷新频率、失败时怎么办。
- [ ] LiveCoach 需要身体姿态：web 平台上用录制的手部数据和 person 模型，Vision Pro 上用手部关节；全身姿态是否需要。
- [ ] “要不要带伞”现在同时出天气和伞的位置；只在会下雨时才指出伞，需要 MOD 之间的依赖（暂不做）。
- [ ] 组件规格（4.3 节）由规则排布；问题关心的部分排在最上的规则是否足够，需要在更多设备上看。
- [ ] StepGuide 一次性列出步骤，是否和 “不做长线 task assistance” 的边界一致。

## 10 Implementation Status

代码在 `~/quest-spatial-studio` 的 `modos` 分支（从 `in-situ-response` 开出，尚未 commit）。旧的 `cue-system` / `cue-primitives` 分支已备份为 `~/quest-spatial-studio-backups/cue-branches-2026-11-16.bundle`，并打了 `backup/cue-*-2026-11-16` 标签。

### 10.1 Done (2026-11-16)

| 部分 | 文件 | 说明 |
| --- | --- | --- |
| Primitive representations | `editor/modos/primitives.json` | 9 个 core primitive representation 的 spec、8 种 item 类型、锚点种类 |
| MODs | `editor/modos/mods/{weather,findmy,worldinfo,lab}.json` | selectors + slots + state + text 两层格式 |
| Registry | `editor/scripts/modos_registry.py` | 加载、校验 MOD（拒绝未知 primitive、未知 selector、错误锚点）；按空间安装 MOD |
| Feed cache | `editor/scripts/modos_cache.py` | 安装 MOD 时缓存它要的 feed；天气 fetcher 是 mock；`weather.resolve` 改为读 cache |
| Memory | `editor/scripts/modos_memory.py` | 实体 + items：info context、authored items（`spaces/<space>/modos/items.json`）、用户资料、feed cache；天气不再是用户资料 |
| Decision module | `editor/modos/decision.mjs` | `choose` / `score` 接口，Jev 是一个 engine；每次决定都有记录 |
| Pipeline | `editor/modos/pipeline.mjs`、`selectors.mjs` | 阶段 0 到 4；地点 MOD 预先填写；多个 MOD 并列；文字在阶段 2 后开始，等阶段 3a 定下承载它的 MOD |
| Server | `server.py`、`agent_store.py` | `/api/modos/memory`、`/api/modos/items`、`/api/modos/install`；一次回应可以有每个 MOD 各一个 ui part |
| Bridge | `agent-bridge.mjs` | 默认用 ModOS；`--pipeline legacy` 跑旧 pipeline 做对比 |
| Tests | `tests/modos-pipeline.test.mjs`、`tests/test_modos.py` | 9 + 5 个新测试；全部测试通过（Node 240，Python 83） |

### 10.2 End-to-End Check on Atlas (real Jev + Gemini)

| 问题 | 结果 | 端到端延迟 |
| --- | --- | --- |
| Weather：“10 月 10 日天气” | Weather MOD；当天三个时段；布局由规则得出 | 2.2 s |
| FindMy：“我的耳机在哪” | FindMy MOD；找到 headphones | 1.7 s |
| Candy：指着糖果 “Can I eat this?” | referent = 糖果；WorldInfo；文字放在糖果旁 | 2.7 s |
| Lab：在 lab 走廊问 “他们在做什么” | Lab MOD 预先填写，选出研究内容动画；文字放在 lab 区域旁 | 2.7 s |
| Packing：“10 月 10 日天气，以及我的刷子在哪” | Weather 和 FindMy 两个 MOD 同时出现 | 1.8 s |
| 指着糖果，同时问天气和能不能吃 | WorldInfo + Weather 组合；文字同时回答两件事 | 2.9 s |

Jev 每次决定约 80–220 ms。给 Gemini 的天气数据改成只给时段（不给逐小时 sample）后，输入从约 12.7k tokens 降到约 4.6k。

### 10.3 Update (2026-11-16, later)

- **Pipeline 按阶段拆成独立 module：** `view.mjs`、`grounding.mjs`（代词和“指着什么”只在这里判断）、`retrieval.mjs`、`mod-selection.mjs`、`fill.mjs`、`compose.mjs`、`text.mjs`；`pipeline.mjs` 只负责编排。Grounding 和 Retrieval 仍合成一次 Jev call 发出，但代码分开。
- **文字是否出现由 MOD 的 `text` slot 决定**（5.4 节）。
- 测试：Node 242 个全部通过。

### 10.4 Digital Twin and the Twin Tab (2026-11-16)

- **`editor/scripts/modos_twin.py`：** 统一的实体视图，分 Layout / Fixtures / Objects 三层（3.6 节）。源文件（`semantic.json`、`composition.json`、用户资料里的物品）不变；ModOS 新增和编辑的内容存在 `spaces/<space>/modos/entities.json`（对派生实体的覆盖 + 新增的物品和设备）。每个实体有 `layer`、`kind`、`category`、`traits`、`parent`、`place`，IoT 设备有 `device`。扫描分类自动映射成语义分类和 traits；场景物体按坐标判断所在区域。
- **层级规则在 server 端校验**：门窗不能放进物体里；物体的 parent 只能是物体；不能形成循环；IoT 必须有 device。
- **用户的物品进了 twin：** FindMy 和 memory 都从 twin 读物品，不再读用户资料里的 `stored_items`。
- **API：** `GET /api/modos/entities`（实体 + 挂在上面的知识），`POST /api/modos/entities`（update / add / remove）。
- **编辑器的 Twin tab（`editor/src/twin-panel.mjs`）：** 统一管理实体。分 Layout、Fixtures、Objects 三部分；Fixtures 和 Objects 都按区域分组，家具按“是哪件家具的一部分”嵌套，墙和天花板默认折叠，物品标出它在哪件家具里；选中后可以改名字、kind、category、traits、所在区域、在什么里面，IoT 设备可以改状态和动作；列出挂在实体上的知识；可以新增物品、设备、信息载体、家具。在 3D 视图里选中 box 时，Twin tab 会跟着选中。几何仍在 Scene tab 编辑。
- 已在浏览器里检查 atlas：三层分开显示，“shelf 3 → bottom shelf”在 Fixtures、Headphones 在 Objects 并标明 in shelf 3/bottom shelf；新增、校验、删除都正常（测试用的设备已删除）。
- 测试：Python 85 个、Node 242 个全部通过。

### 10.5 Tailoring MODs: Overrides, Forks and Representation Variants (2026-11-16)

- **格式：** `primitives.json` 新增 `setting` 参数（highlight.dismiss、ego-object.dismiss、situated-text.duration、ambient-effect.lock）；四个 MOD 都有 `variants` 和 `default_variant`，顶层 `text` 移到每个变体里；WorldInfo 新增 `voice` slot（ego object，`effect` 由作者留给 Jev 在 bounce / grow / color 中选）。
- **Registry（`modos_registry.py`）：** `effective()` 合成 MOD；`customize` / `reset` / `fork` / `remove_fork` / `uninstall`；`catalog()` 给编辑器列出每个 MOD 能改的东西。校验：变体只能引用已有 slot；文字 slot 必须是 situated text 或 ego object；setting 的值必须在允许范围内；`derived` 和 `pick-*` 参数不能手动设。
- **Pipeline：** 只填写当前变体用到的 selector（Weather 的 "Text only" 不再问日期和时段）；作者留空的 enum 参数在 fill 阶段由 Jev 选；ego object slot 生成旧格式的 ego part（说话的是 referent）；文字 slot 是 ego object 时，文字以第一人称由该物体说出（`context.voice`），referent 是区域时退回普通文字；文字放在 layout slot 1 的规则从 "Weather 特例" 改为 "文字相对于一个 data widget / ambient effect 放置"。每个 part 带上 `mod: {id, variant, slot, settings}`。
- **Server：** `GET/POST /api/modos/mods`；已安装的 MOD 若当前变体有 ego object，就允许 ego part；复制出的 MOD 沿用基础 MOD 的 part 种类。
- **编辑器的 MODs tab（`editor/src/mods-panel.mjs`）：** 每个 MOD 一张卡片：安装开关、变体选择（列出每个变体用到的 primitive representation，文字所在的 slot 高亮）、设置、文字开关、适用范围、额外知识、额外示例问题、Save / Reset / Delete、复制为新 MOD。
- **端到端（atlas_rec_3，真实 Jev + Gemini）：** 同一个问题 "Can I eat this?" 指着糖果。默认变体：文字放在糖果旁。切到 "The thing speaks" 后：ego part 0.44 s 出现（Jev 选了 bounce），文字 1.9 s 完成，内容是第一人称 "Yes, you can eat me…"。测试用的对话和设置已删除。还没有在编辑器里逐帧看 ego 气泡的渲染（part 格式和旧 ego mod 相同）。
- 测试：Node 245 个、Python 全部通过（新增变体、设置、覆盖、复制、ego 文字、额外知识的测试）。

### 10.6 IoTControl, Wayfinding and ObjectStatus (2026-11-16)

三个 foundational MOD 从 spec 变成可运行的（其余 5 个仍是 spec：能被选中、只用文字回答）：

| MOD | Context info（第 3 步） | Fill（第 4 步） | 画面 |
| --- | --- | --- | --- |
| IoTControl | 问题所关于的地方加上这里（及房间里的东西）的 `device-state`：由 twin 里的联网设备生成 | 一次 choice：哪个设备 + 做什么（它的某个 action，或只显示控件） | 设备被框出；旁边一个**空间中的控制面板**（和 Weather 的控件一样是场景里的物体）：放在设备右侧、竖直、朝向用户；由状态的**种类**实时组合，不按设备定制：power → 开关，带范围的数 → 滑条，有选项的值 → 分段按钮，任务 → 进度条 + 剩余时间（持续走），队列 → 下一个，其余 action → 按钮。问到的 action 以「旧状态 → 新状态」的变化呈现；按面板上的控件会执行 |
| Wayfinding | 关于整层楼的说明（关于 ≥2 个地点的 item，如 2F directory） | 一次 choice：去哪个地点 | 目标房间的门被框出，门上有名字；门不在视野内时，视野边缘有箭头；文字从用户当前位置给出路线 |
| ObjectStatus | 这里（及房间里的东西）的 `status` item | 每个东西一个 noul（都低于 0.5 时取最可能的那个，≥ 0.3） | 被问到的东西按状态着色框出（neutral 蓝 / attention 黄 / warning 红）；文字说明状态 |

- **实现：** `modos/selectors.mjs` 新增两种选择来源：从 MOD 的 context info 里选（设备、状态），从空间的地点里选；`modos/compose.mjs` 生成 `highlight` 和 `control` 两种 part；`scripts/modos_parts.py` 把它们解析成几何（地点 → 它边界上离用户最近的门）并执行设备 action（mock 协议，状态存在 twin）；`POST /api/modos/devices`；网页端 `src/highlight.mjs`（多个目标、按状态着色、箭头、门牌）和 `src/control-panel.mjs`。
- **数据（atlas）：** layout 新增 printer、desk lamp、espresso machine（位置由录制的深度算出）；lamp、TV、printer 标为联网设备；新增 4 条状态和 2F directory。
- **实测（真实 Jev + Gemini）：** “Turn on the lamp” → IoTControl，desk lamp: on，约 1.0 s；“How long until my print job is done?” → IoTControl，打印机面板显示 Ana's CHI poster 7/12 页、剩 2 分钟并持续走，文字 “about 2 minutes left”，约 1.0 s；“Is the printer free?” → ObjectStatus，printer 0.96，约 1.4 s；“How do I get to the kitchen?”（在 lab）→ Wayfinding，Kitchen，路线文字正确，约 1.1 s。
- **Delegate（新 foundational MOD）：** 替用户做涉及别人的事（发送、分享）。Context info：用户的联系人 + 指着的东西 + 周围东西的说明。Fill：收件人（从联系人里选）、附件（从周围的东西里选，指着的那个会标出来）；**消息由语言模型写，是这个 MOD 的文字 slot**，在 Fill 选出收件人后开始写。画面：新的 primitive representation **Action Card**（空间中的卡片，放在附件旁、朝向用户）：收件人、附件、可编辑的消息框、Send 按钮；按 Send 才执行（mock：写进 `spaces/<space>/modos/outbox.json`）。实测 “Send this poster to Alice”（指着海报）：Alice Chen 0.99，海报 0.84，约 2.2 s 写好草稿。
- **面板摆放：** 设备面板和 Action Card 都放在东西旁边：先试用户视角的右边，再左边，再东西前方（朝用户），取第一个整块都在视野里的位置。
- **以后：** Wayfinding 改成地面上画路线（类似 Google Maps AR），需要新的 primitive representation。

### 10.7 Recordings, Alternatives, Spatial Components (2026-11-16 – 11-17)

- **Delegate（Action Card）**、**同一需求只留一个 MOD**、**FindMy 负责“要带上的东西”**：见 0 节和 5.3 节。
- **录像：** 每个 MOD 都有录像（`recordings/<mod>/`，由 `editor/demos/modos-videos.json` + `demos/record.mjs` 一条命令重录），以及给观众看的 dashboard（`recordings/index.html`，已发布为私有页面）。mock 天气预报改为从今天开始。
- **进行中：** 共享的空间组件库（4.3 节）：所有面板改成和 Weather 控件一样的空间物体；设备数据改成 Inputs / Outputs（3.7 节）；FindMy、Wayfinding 的高亮、门牌、方向箭头都走同一套 Highlight / Label / Guidance 渲染。

### 10.8 MOD-Declared Spatial UI (2026-11-17)

- **MOD 声明 UI。** 每个 slot 有 `ui`（`fixed` / `flexible` + `when`），规则在 `modos/ui-rules.mjs`，服务器和客户端共用；注册时检查 cue 名和条件名（`scripts/modos_registry.py`）。
- **Compose 带上声明和请求里的事实**（`modos/compose.mjs`：`question.about`、`data.days`、`data.steps_per_day`、`intent`、`target.pointed`、`request.second_person`）；服务器把它们存在 part 的 `mod` 里（`scripts/agent_store.py`），合并后的回答按 kind 保留各自的 `mods`（`src/response-parts.mjs`）。
- **客户端按规则画 cue**，视野相关的事实在这里算（目标是否在视野内、用户在哪个房间、门是否可见）：
  - `src/cue-host.mjs`：FindMy、Wayfinding、ObjectStatus、IoTControl 的设备标记和方向；替换了旧的 `highlight.mjs` 渲染。
  - `src/device-cues.mjs`：设备的每个 Input / Output 按 value type 和意图选 cue（Slider、Gauge、Edge Tabs、预置 Icon Button 或 Text Button、Progress Rail、Card Stack、Pinned Tags、Status Pulse），可以按、可以拖；替换了设备面板。
  - `src/action-cues.mjs`：消息组合（Contact Chip、可编辑的 Text Input、Tether 或 Photo Capture + 照片卡、Send），按 Delegate 的声明画；替换了 action card。照片随消息存在 outbox 旁边（mock）。
  - `src/weather-preview.mjs`：Weather 的控件改用库里的 Date Picker 和 Playback。
- **文字形式：** Object-centric Dialogue 只在指着一个东西并用第二人称问它时出现（compose 里按规则判断，例："Can I eat you?"）。
- **主题：** 亮 cyan；可点的都是胶囊形；青蓝底上的字不加阴影；去掉了不来自数据或决定的文字（"waiting for you" 等）。

### 10.9 Routing, Text Forms, Weather Placement, Recording Queue (2026-11-17)

- **Floor Path follows a route** (`src/floor-route.mjs`). A* over a 0.25 m grid of the room polygons (`semantic.rooms`). A step may not cross a wall (`semantic.walls`, the base of each outline) except inside a door's opening (`semantic.openings`, Door or a walk-through Opening at least 1.8 m tall); corridors that meet without a wall connect directly. The grid path is pulled tight, and chevrons are laid every 0.45 m along it (up to 14 m), each on its own room's floor height. When the twin has no route there is no path, never a line through walls. On atlas, lab → kitchen goes out of the lab door and down the corridors in about 5 ms.
- **"Can I eat you?" chose no MOD** because grounding scored the candy 0.4 (its prompt only knew "this"), so there was no referent and WorldInfo, which is scoped to the referent, was skipped, although the request's `about` chose the thing. Fixed in `modos/grounding.mjs`: the prompt now covers questions put to the thing in the second person, and a rule (`addressedReferent`) takes the looked-at thing as the referent when the question says "you", `about` chose it, and "you" is not the assistant ("can you turn on…").
- **Embedded vs Floating Text is read from the declaration.** The host MOD's text slot `ui` travels with the text part (`text_ui`, `modos/compose.mjs`, stored by `scripts/agent_store.py`). `src/placement.mjs` computes `surface.score` for the best surface spot (clean background × level on screen × not above the eye, 0 to 1; 0.5 needs a clutter cost of 2 or less) and lets `modos/ui-rules.mjs` decide. Floating Text stands in front of the user, upright, and stays while in view; text on a surface stays while it scores 0.4 or more there, so the form does not flicker at 0.5. Info answers use the same rule in place of `INFO_SETTLE`.
- **Weather controls are a generic UI cluster** (`src/cluster-placement.mjs`, the `user-reach` anchor of §4.5), no longer a footer inside the answer panel. The candidate spots are tried in order: whole cluster in view, not over the answer text, 0.55 to 0.75 m away, low in the view. The cluster is upright and turned to the user, sized to about 23° of view, placed once per answer (and once more when the answer text gets its spot, to stay clear of it) and locked in the world, and placed again only after 1.5 s out of view. The answer reserves no footer now.
- **Status Pulse says the state, not the name.** The printer's pulse read "printer" because the cue was given the target's label. The state now comes from the status data (`state`, else the summary's first phrase after the name: "Lab printer: in use, printing…" → "In use"; `stateText` in `modos/selectors.mjs`) and travels as `highlight.states`; with no state the pulse is the dot alone.
- **Controls are Adjust or Explore** (§4.4). Adjust cues change the thing and send the change once the user makes it: a press sends at once; the Slider follows a drag on the bar and sends when the user lets go (`src/device-cues.mjs`). Explore cues (Date Picker, Playback) only change what the answer shows. The reel's cue gallery has both groups.
- **Two arrows, both in the library.** Arrow Ahead (and Floor Path) lead the user somewhere; the new **Text Arrow** (`textArrow` in `src/spatial-ui/cues.mjs`) links text to the thing it is about. It replaces the hand-made info-answer arrow (an SVG overlay with adaptive colours and a blurred halo, `src/app.mjs`) with a bright cyan polyline in the cues' glow style, laid out by `arrowBetween` and drawn in the room. MODs declare it on their text slot (`textArrow when text.apart`: WorldInfo, BookCompanion); `text.apart` holds when the text and the thing do not overlap on screen and there is room for an arrow.
- **Recording is one queue.** `npm run record -- <clips or MODs>` (e.g. `npm run record -- weather wayfinding`) asks again and records into the reel (`context/recordings`, manifest included); a failed clip is reported at the end while the rest are still recorded. `npm run record:cues` captures the cue gallery.
- Tests: Node 251, Python 87, all pass (new: `tests/floor-route.test.mjs`, the second-person grounding case).

### 10.10 Editor Aligned with the Design (2026-11-17)

The editor's side panel had grown from the earlier per-mod system. It now follows the pipeline and the library:

| Tab | What it holds | Was |
| --- | --- | --- |
| Agent | Local setup, sessions, Replay (Resume on first response) | also global "Responses" and per-mod overrides |
| Input | Info selection (Jev judgement or score only), hands perception: what a request starts from (stage 1) | in Agent |
| MODs | Each MOD's install switch, representation, settings, places, knowledge, examples | (unchanged) |
| UI library | Text: Size, Writing, Placement (Stability), Reset text | "Behavior" |

- **MOD choices are MOD settings only.** The per-mod overrides (Text response, Hide after 5 s, Remove effect on hand approach or touch, Lock location) and the Weather / FindMy / Object switches are gone. The renderers read each part's `mod.settings` (`src/ui-settings.mjs` `modSetting`): FindMy's container `dismiss: hand-approach`, a speaking object's `dismiss: hand-touch`, Weather's sky `lock`, and the text slot's `duration: 5s` (carried with the text part as `text_mod`). Whether a MOD answers in words is its variant's text slot.
- **No pinned or fallback text.** "When no surface fits" and "Fixed text response" are removed with the code behind them (`viewFixedPose`, the fixed pass). Every answer follows a text form: the host MOD's declaration, or the library default for an answer no MOD hosts (`DEFAULT_TEXT_UI`: Embedded Text at `surface.score ≥ 0.5`, else Floating Text). A declaration with Embedded Text only waits for a surface. The info answer's own settle rule (`INFO_SETTLE`) is replaced by the same declaration.
- **Removed code:** `src/response-settings.mjs` (and its tests), the DOM weather preview (`createWeatherPreview`), the arrow halo. Settings saved by the earlier panel carry over once (stability, resume, the two distances).
- Tests: Node 242, Python 87, all pass.

### 10.11 One Space Tab; One Scan for Atlas (2026-11-17)

- **Scene and Twin are one Space tab.** They listed the same things twice: the Scene tab's Layout boxes and Scene objects are the source of the Twin's Fixtures and Objects (`scripts/modos_twin.py` derives `layout:` and `comp:` entities from `scan/semantic.json` and `composition.json`). The Space tab now has, from the top: the space, **Recording** (its scan, its recordings and alignment, the objects placed in it), then **Entities**, one tree (Layout, Fixtures, Objects; by place, nested by what each is inside). The selected entity shows one panel: **Geometry** (the layout editor's edit mode and tools, Frame, a furniture's 3D model), **Semantics** (kind, category, traits, place, inside, a device's inputs and outputs) and **Knowledge** (attached items and the info editor; a place's info is its zone's). An entity without geometry (an item known by name) says so.
- The tree keeps the earlier outline's look and controls (`src/layout-outline.mjs`: compact rows with a kind icon in one bounded box, Places / Types grouping, collapse, hide and lock for what has geometry, delete, model swap and rename in edit mode, double-click to frame), now over the twin's entities, including those without geometry; the selected entity's panel opens right under its row, full width and compact: Geometry tools on top (only for what has geometry), then Semantics or Knowledge (a seg control). The row names it, so the panel does not. Every edit is saved as it is made (no Save button). Place, Inside and Category are not shown for what has geometry: place and nesting come from the scan and the layout (the tree shows them), and Category was only an input to a word match. **`content` is now a trait** ("With content", a switch in Semantics): derived by default from the name and scan category (`modos_twin.CONTENT`), set or cleared by hand, and read by `target.has_content` (`modos_parts.has_content`, Corner Brackets instead of a box). Only an entity known by name (a registered belonging) is put inside a container by hand. The attached info is edited in Knowledge and not listed twice. The Twin tab is gone. Picking in the 3D view and in the tree stay in step.
- **Atlas keeps one scan**, `atlas-reassembled` (the repaired second floor, validation passed; the layout and the recordings are registered to it). The original scan and the first repair were deleted from the space and from `private/atlas/scans` (about 860 MB).
- Tests: Node 242, Python 87, all pass.

### 10.12 Space and UI Library Panes; Explanations Behind "?" (2026-11-17)

- **Space tab: two panes.** A seg control under the space picker: **Scene** (its scan and recordings with their alignment) and **Entities** (the entity tree and the objects placed in this recording). The separate Recording heading is gone.
- **UI library: two panes,** Text and Cues, with clearer names (Text size, Headings, Write out, Stroke by stroke, Stability with "Moves freely / Stays put", Turn with the thing with "Never / Up to 90°", Hand approach and Hand touch with "Closer / Farther") and one "Reset text" at the bottom of Text (it resets all text settings, not only the lettering).
- **Explanations are behind a "?",** shown in the editor's tooltip on hover or focus (`.help[data-tip]`, `src/app.mjs`); pressing it inside a switch's label does not toggle the switch. No paragraph of explanation is shown by default.
- **Data:** the posters the scan had filed as a cabinet or shelves (music-brain user study, vision_sean, the three lab philosophy posters) are marked With content; their kind is still the scan's (furniture, container).

### 10.13 Overfit Features Removed (2026-11-17)

The rebuild exists so that computation generalizes. Small, concrete features made for one MOD or one scene in the earlier system are removed in the feature and in the code, not only in the UI:

- **Dismissal by hands.** The `dismiss` setting of Highlight and Ego Object (`hand-approach`, `hand-touch`), the hand approach and touch distances, `src/findmy-approach.mjs` and Ego's `setRemoved`, with their tests. A cue stays while its answer is shown.
- **Answer text switch.** The `text` customization (`text_off`) is gone from the registry, the catalog and the MODs tab: whether a MOD shows text is its variant's text slot, as authored. `customize` now refuses keys it does not know instead of dropping them.
- **Info-answer knobs.** "Turn with the thing" (`floatParallel`) and "Smallest on a surface" (`infoMinShrink`) are fixed constants in `src/placement.mjs`; Text Arrow's thickness is the cue's own (no `arrowWidth`).
- **Stability is the library's only.** It no longer moves Weather's sky (the sky follows its MOD's `lock` setting).
- The UI library tab is now Text only (Size, Writing, Placement · Stability). The Vision Pro path (`src/vision-panel.mjs`, `scripts/vision.py`, the visionOS app) still carries the old settings until it is ported.
- Tests: Node 239, Python 88, all pass.

### 10.14 WorldInfo Speaks by Rule Only; No UI Left to the Model (2026-11-17)

- **The voice variant is gone.** Object-centric Dialogue came only when WorldInfo was switched to its "The thing speaks" variant, so the rule (`target.pointed & request.second_person`) mattered only after a manual switch. WorldInfo now has one representation: the answer slot (Floating / Embedded Text, Text Arrow) and the voice slot (dialogue + ego motion). The rule alone decides: pointed at and asked as "you", the thing answers in the first person (`compose.mjs` hostOf); otherwise the text slot shows the answer.
- **No open parameters for the model.** The "chosen per answer" mechanism (an author leaving an enum open, Fill asking Jev, `selectors.mjs` slotParam) is removed, with the enums that used it: Ego Object's `effect` and `tone`, and Highlight's unused `tone`. A speaking thing's motion is the library's one (bounce). Slot params a person can set are `setting`s only (duration, lock). `effective` refuses a variant on a MOD that has none.
- The legacy pipeline (`scripts/jev-pipeline.mjs`, `--pipeline legacy`) still has its own object mod that picks a motion and colour; `src/ego.mjs` keeps grow and color for it.
- Tests: Node 239, Python 88, all pass.

### 10.15 Dialogue Is a Text Form; Legacy Pipeline Removed (2026-11-17)

- **Object-centric Dialogue is one of the text slot's forms**, not a part of its own. WorldInfo has one slot, `answer`, which declares `dialogue when target.pointed & request.second_person` and lets it stand `instead_of` Floating Text, Embedded Text and Text Arrow (`instead_of` may now name several parts, fixed or flexible). When it holds and the referent is a thing that can speak (`layout:` or `comp:`), `compose.mjs` gives the text part `dialogue: {speaker}`, the text is written in the thing's voice, and the editor places it as a speech bubble on the thing (`src/spatial-ui/dialogue.mjs`, `src/placement.mjs`). There is no motion and no ego part; the `ego-object` primitive, `src/ego.mjs` and `scripts/ego.py` are gone.
- **A dialogue answer is not an info answer.** The store no longer attaches the question's info item to a text part with `dialogue`, and placement tries the bubble first.
- **Legacy pipeline removed:** `scripts/jev-pipeline.mjs` (`--pipeline legacy`), `scripts/mcp.mjs` and the old tool-agent prompt (`agent/AGENTS.md`), the `/api/agent/context` and `/api/agent/visible` endpoints, the `weather_mod` / `findmy_mod` / `ego_mod` / `text_response` question flags, the old FindMy renderer, and the `@modelcontextprotocol/sdk` dependency. The Jev client is `scripts/jev.mjs`; the scene's boxes and the recorded camera pose moved from `ego.py` to `scripts/modos_twin.py` (`boxes`, `camera_pose`).
- Tests: Node 195, Python 85, all pass. The WorldInfo clips are re-recorded: "Can I eat you?" is a bubble on the candy bowl.

### 10.16 Headings, Device Progress, Natural Questions (2026-11-17)

- **Yes/no questions get Yes, No or Not sure as the heading.** A rule (`isYesNo` in `modos/text.mjs`: an auxiliary verb first, possibly after a filler, and no "or" choice) marks them; the model is told (`context.title_form`) and its title is held to the three words while it streams. Other answers keep the model's short title. Object-centric Dialogue has no heading.
- **A device task is done of total, and whose.** `{title, done, total, unit, owner?}`: no time estimate anywhere (the context summary, the Progress Rail). A printer reports pages, not minutes.
- **The panel components are gone** (`src/spatial-ui/kit.mjs` keeps only text: `label`, `wrapLines`); the cues replaced them (§4.3 describes the earlier panel library).
- **Clip questions read like speech:** situated, casual, sometimes broken, and never about what can simply be seen.
- **What the user is reading** is a user-context item (`user:reading`, about the user and the book); BookCompanion always asks for it, so "what happened in this chapter again?" is answered even when the book is not grounded as the referent.
- **"whose is that printing?"** is answered by IoTControl (the job's owner is device state), so it is its own IoTControl clip; ObjectStatus asks "anything running low over here?".

### 10.17 The Gallery Is Asked, Not Recorded (2026-11-17)

- **An example is a question asked in ModOS.** It is answered questions of a recording's conversation, tagged where they are with `gallery` = {name, mod} (`scripts/gallery.py`; the conversation shows ★ at the end of its name); asked again, the new questions take their place once answered. The main page's Gallery reads `context/gallery/examples.json` (and `examples.js` for the file) and shows each example's question above a still of the camera view at its answer.
- **A queue, not a re-recording.** `npm run gallery -- [examples or MODs]` (`demos/gallery.mjs`, the list in `demos/gallery-examples.json`) asks each example again through the editor's own ask box at its `ask_at`; when the answer settles the editor sends a still (`POST /api/gallery/still`); the older conversations of that example are then deleted (`POST /api/gallery/replace`). After a change, only the affected examples need to be queued.
- **Opened, an example is live.** The Gallery opens the editor's example view (`?example=<name>&conversation=<id>`) in a dialog: the recorded camera with its cues and bubble, the player, the ask box and the pipeline, as the recordings looked. It replays the example from where it was asked; a question asked there (its scene's bridge starts by itself, `POST /api/agent/bridge`) becomes the example, still included; Delete removes the latest question.
- **Removed:** the recordings (videos, posters, manifest, review frames) and `demos/record.mjs` with its clip list. The Vocabulary's cue pictures moved to `context/vocabulary/` (`npm run vocabulary`).
- Tests: Node 195, Python 86, all pass.

### 10.18 Floating Text Fixed to the View (2026-11-17)

- **Floating Text follows the camera.** It is no longer a panel left in the room: it is centred in the view, the bottom of its letters 0.03 (of the view's -1..1 height) above the question caption's actual top (`ctx.captionTop`, one line or two; `FLOAT_VIEW.gap`), and once the caption is gone, at -0.9 (`FLOAT_VIEW.bottom`): it settles lower when the answer is done. It is placed again whenever the caption changes, even while the video is paused. 1.1 m along the view, view-sized, leaning back 12° so it faces the eye a little from below (`src/placement.mjs` floatInView). It grows upward from that edge, so a streaming answer never covers the caption, and it is placed again every frame, which also re-fits it once the stream completes (`src/agent.mjs` moves it without logging a new placement).
- **Wide and centred.** It takes the widest line length whose whole panel stays in view (1920, 1600 or 1280 canvas px, `FLOAT_COLUMNS`), so it reads in few long lines, and keeps that width while it still fits (no reflow as the stream grows). Its ink, not its panel, is centred, so short text set wide stays in the middle.
- **Drawing changes need no new answers.** Where and how an answer is drawn is computed by the editor when it shows the answer, so every Gallery example opened (or the Demo replayed) already shows the change. Only the Gallery's stills are images: `npm run gallery -- --stills` takes them again from each example's replay in the example view (`?still=1`), with nothing asked and no model called. `npm run gallery` (asking again) is for changes in what the answers are: the pipeline, MODs, data, prompts.
- **Tighter heading.** A heading's lines sit closer (line height 1.08 of the type size, the body keeps 1.22) and the gap between the heading and the text is 6 px instead of 18 (`TITLE_LEAD`, `BODY_LEAD`, `TITLE_GAP`).
- **It fits its text.** Floating Text keeps no room for a streaming answer to grow into (text on a surface still keeps two heading lines and four body lines, so it does not move while it streams): its box, and the glass behind it, is the text as it is, re-fitted every frame (`fit` in `src/agent.mjs` glowTexture). The glass fades out half a body line beyond the ink instead of a whole one (`GLASS_FEATHER`), for all text.
- Embedded Text, Object-centric Dialogue and text about a thing (beside it) are unchanged.
- Tests: Node 195, Python 86, all pass.

### 10.19 View Stack, Live Vocabulary, Controls Fixes (2026-11-17)

- **View stack (§4.5 rule 6).** UI that is not on a real thing in front of the user stands fixed in the view, centred, above the answer's text and never over it: caption, then Floating Text (the top of its ink, `agent.viewTop`), then each such UI upward (`src/cluster-placement.mjs`: `viewAnchor`, `STACK` = gap 0.03, base -0.9, 0.7 m). Weather's Date Picker and Playback are always on it (their anchor is now `user-view`; the old user-reach cluster, `userReachPlacement` and `createStay`, is removed). A device's controls go on it when the device was out of view at the question's frame (`src/device-cues.mjs`: built around a stand-in box, then placed every frame); they stay there for that answer.
- **The Vocabulary is the library, live.** Each part on the main page is a 3D scene, not a picture: the library's own part (`src/spatial-ui/cues.mjs`, the answer text of `src/agent.mjs` via `answerTexture`, the dialogue bubble, the view stack, Weather's ambient effect, LabInfo's diorama) in an example room (a lab with a desk, lamp, mug, printer, TV, poster and plant; a kitchen through a door) with example data (`src/vocabulary.mjs`). One WebGL canvas behind the page draws every tile; a tile opened is a larger view to walk around and use: the Slider dims the lamp, Edge Tabs switch the TV, the Icon Button turns the lamp off, the Date Picker and Playback move, Contact Chips pick, the Text Input edits, the poster takes a photo again. A change in the library shows there at once. The main page loads it from `system/editor` (served: `python3 -m http.server` at the root). Removed: the cue pictures (`context/vocabulary/`), `demos/cues-capture.mjs`, `npm run vocabulary` and the editor's `window.modosCues` preview hook.
- **Corner Brackets on flat things.** Each arm is as long as the thing allows: a poster or a screen keeps full arms across its face and short ones through its depth (they were as short as the thing was thin).
- **Slider.** Dragging no longer enlarges its label (the label keeps the size the cue was built at), and the user's own change shows at once, without the transition that shows what an answer changed.
- **Weather's controls are easy to hit.** Each date and the Play button carry a larger invisible pad.
- **MOD settings apply at draw time.** A part keeps which MOD and slot made it; what that MOD declares and how it is set are read when the part is drawn (`src/current-mods.mjs`, `GET /api/modos/installed`). So a change in a MOD's settings (Weather's sky locked) shows on every answer, old ones and the Gallery's included, with no new answer.
- **Playback opens at the answer's moment.** A timeseries selector also asks, in the same fill call, which one entry answers the question most directly (where what is asked about happens, or the time it names; `none` when no single entry does): its *focus* (`selectors.mjs`). Within that entry it is the moment of the same summary, else its first, and it counts only when it is among the selected moments. The focus travels with the part (`weather.focus` → `preview.focus`, `scripts/weather.py`), and the Playback (and with it the Date Picker and the ambient effect) opens there, holds it 3 s (`FOCUS_HOLD`), then plays on; with no focus it opens at the first moment. It is a feature of the Playback over any timeseries, not of Weather: the question is generated from the data, never written per MOD. Asked again: "is it gonna rain this weekend?" opens on Thursday 10:00, rain showers; "should I bring my umbrella?" on the morning's snowfall.
- **Playback's button is the icon alone** (▶ or ⏸ in a round button), no word.
- **Bridges stop with the server.** A server stopped by a signal now exits through its cleanup, so the agent bridges it started stop too (stale bridges with old code had been answering questions).
- Tests: Node 197, Python 87, all pass. Weather's examples asked again (`npm run gallery -- weather`).

### 10.20 Controls by Component; Choice; Send (2026-11-18)

- **Choice** replaces Edge Tabs and Contact Chip: one control, a row of capsules for a few short options, a dropdown for more (`choice` in `src/spatial-ui/cues.mjs`). IoTControl's choice inputs and Send's recipient use it.
- **Removed:** Tether Send, Photo Capture (the attached thing is marked with Corner Brackets or Breathing Box instead), the Adjust / Explore / Interactive rows. The photo card is **AR Photo**.
- **Delegate is now Send** (`modos/mods/send.json`). Its action part carries the contacts (for the Choice) and whether the attached thing has content (for the mark).
- **Controls are grouped by component** in the Vocabulary: Slider, Choice, Icon Button, Text Button, Text Input, AR Photo, Date Picker, Playback; when a value is sent is how a MOD uses it.
- Tests: Node 197, Python 85, all pass.

### 10.21 Several Recipients, Drafts Without Names, AR Photo, Named Arrow (2026-11-18)

- **Several recipients.** Send's recipient selector is `pick-many`: one score per contact, and by rule everyone the request names (first or full name; "send this to Alice and Ryo"). The action carries `to` as a list and `pick: many`; the Choice shows it multi-select ("Alice Chen +1 ▾"), each press adding or removing a person; Send waits while nobody is chosen. A pick-one selector gives a single-select Choice; nothing about this is Send's own.
- **The draft names nobody.** A value the user can still change in a control is never restated in text: the draft context leaves the recipients out, and the instruction forbids naming, greeting or addressing them in the title or body. It says whether a photo or the thing itself is attached.
- **"This" while pointing.** The thing picker takes the thing pointed at when the request says this, that or it (it had fallen to "nothing attached" on a borderline score).
- **AR Photo** is drawn above everything around it, and is taken from the frame as drawn, right after the marks: the Corner Brackets on the poster are in the photo.
- **Arrow Ahead** names its target at its tip, upright.
- Tests: Node 198, Python 85, all pass. Send's examples asked again, with a new one for two recipients.

### 10.22 Presses Stay With Controls, Anchored Bubble, Gallery Examples From the Editor (2026-11-18)

- **A press a control takes is its own to the end.** A press on a control (Send's Choice, Text Input, Send; a device's controls; Weather's) rebuilds what is under the pointer, so the click that followed found nothing there and fell through to the editor, which picked the thing behind (the poster under its mark) and replayed the question. The click after a taken press is now always swallowed. Marks take no presses.
- **An open dropdown lies over what is below it**, drawn in the transparent pass after every opaque part (it had drawn under the draft).
- **Anchor dialogue bubble** (UI library, Text): on, the Object-centric Dialogue bubble stays just above the thing that speaks, sized once, and turns to the user every frame; off (the default), it moves to where it fits in view, as before.
- **Gallery examples from the editor.** Clicking a question's dot on the timeline picks it: × deletes it, ★ adds it to the Gallery. Shift-click picks every question from the first picked to this one; ★ adds them as one example, under the first one's MOD. The questions and answers are copied into a new conversation tagged as the example (named after the MOD and the question's first words), the example is added to `demos/gallery-examples.json` (`questions: [{ask_at, question}]` when several), and its still is taken by a hidden replay. `npm run gallery` asks several questions in order in one conversation; the example view replays from the first; the main page lists every question on the card.
- Tests: Node 198, Python 88, all pass.

### 10.23 WorldInfo's Mark From the Library; Weather Knows the Weekday (2026-11-18)

- **WorldInfo declares its Mark.** An info answer's thing was marked by older code of its own (`src/info-visual.mjs` corners, coloured like text against the frame: black on a bright poster), declared by no MOD. The corners and their colour sampling are removed. WorldInfo's text slot now declares `cornerBrackets when target.has_content`, else `breathingBox` (none when the thing speaks: Object-centric Dialogue); the server says whether the thing has content (the twin's `content` trait), and the editor draws the library's part from the MOD's current declaration. The Text Arrow stays, chosen by the same facts.
- **The day options say the weekday.** A timeseries' days were offered to the model as bare dates ("Does the question ask about 2026-11-21?"), so "this weekend" picked Wednesday to Saturday. Each day now reads as people say it ("Saturday 2026-11-21, in 3 days"), in the options, the focus and the data the text is written from.
- **The mock forecast's day words follow its dates.** The feed cache moved the recorded forecast to start today but kept the recording's labels ("Friday, Oct 09" on a Wednesday); a mock fetched on an earlier day was never fetched again. Its labels are now made from its dates (`user_context.relabel`), and a mock is fetched again on a new day.
- Mock data: the Music-Brain study flyer's box is a thin box on the bulletin board, the flyer's size.
- Tests: Node 197, Python 88, all pass. Weather's examples asked again; WorldInfo's still taken again.

### 10.24 Tailoring Says What a MOD Is For; Days Come in Stretches; Pipeline Stays (2026-11-18)

- **Tailoring no longer sets where a MOD applies or what it knows.** The MODs tab's Where (places) and Knowledge (extra items) are removed, with their code: the `scope` and `knowledge` customizations, knowledge "added when tailoring" in selection and text, and their tests. Where a MOD applies (global, the referent, a place MOD's places) and what it reads stay its author's.
- **Description and examples are tailored.** The decision model chooses MODs by them, so the tab edits both (they replace the author's; Reset brings them back).
- **Days come in stretches.** Of the days scored .5 or more, a stretch apart from the strongest is kept only when it scores within .2 of it (`stretches`, modos/selectors.mjs): "this weekend" no longer brings today along out of habit; "today or Saturday?" keeps both.
- **The pipeline stays on the latest question** asked by the current moment, after the replay plays on past it (it emptied once the hold ended).
- **Vocabulary tiles turn when dragged**, in place; a press without moving opens them. The Gallery's question under the pointer is a muted deep cyan.
- Tests: Node 197, Python 88, all pass. The weekend Weather examples asked again: Saturday and Sunday only.

### 10.25 A Message With Nothing in View Stands in the View; Bridges Renew (2026-11-18)

- **The view stack takes Send's message too.** With no thing in view to stand by (nothing attached, as "send this weather to Alice", or the attached thing out of view when asked), the message's column (Choice, Text Input, Send) is on the view stack (§4.5 rule 6): fixed in the user's view, centred, above the answer's text and the other UI there (Weather's Playback), for the whole answer. It had been left in the room where the question was asked (`src/action-cues.mjs` `place`, after the device's controls in the stack). With a thing in view it still stands beside it.
- **A bridge renews itself when its code changes.** Between questions it checks `scripts/` and `modos/`; changed, it runs a fresh bridge with the same arguments and passes stops on to it. A bridge left running from before a change had answered with old code (the empty message on ACEM: the draft step was newer than the bridge).
- Tests: Node 206, Python all pass.

### 10.26 Floating Text by Default; Write on Surfaces Is a Library Switch (2026-11-18)

- **Every answer is Floating Text unless Write on surfaces is on** (UI library › Text, `text.embed`, off by default; `src/ui-settings.mjs`). On, the MODs' declared rule decides as before: Embedded Text where a surface scores 0.5 or more. Found on ACEM: a weekend weather answer was written on the back of a door that scored 0.508, small and under the Date Picker. Info answers (an answer about a poster) follow the switch too; Object-centric Dialogue does not (its rule is pointing and the second person). A declaration with Embedded Text only still waits for a surface. Switching it places every answer again.
- Tests: Node 207, Python all pass.

### 10.27 Asking Whether to Bring It Is Weather's, Not FindMy's (2026-11-18)

- **By description and examples only** (no rule, no code): FindMy is for where a belonging is, and for when the user says they will take or bring it ("I want to bring my umbrella with me", "wait, where is it?"); not when they only ask whether they should bring it, which asks for advice. FindMy's description says so, its "Should I bring my umbrella?" example is gone, and Weather has "am I supposed to bring my umbrella?" among its examples.
- **Measured with Jev** (`demos/live-replay.mjs`, asked): "should I bring my umbrella with me?", "am I supposed to bring my umbrella with me?" and both after "is it gonna rain this weekend?" choose Weather alone (.96 to .98); "I want to bring my umbrella with me" FindMy .92; "where is my umbrella?" FindMy .98; "should I bring my umbrella? where is it?" FindMy .97 and Weather .98. "is it gonna rain this weekend? where is it?" (no umbrella said) chooses Weather alone.
- Weather's Gallery examples asked again: "should I bring my umbrella?" now shows the evening's rain, with no arrow to the umbrella.

### 10.28 A Message Shows Even When Its Recipient Is Not Found (2026-11-18)

- **Found on ACEM**: "…send a message to Alex on the weather" (speech heard Alice as Alex) chose Send (.95) but showed no message at all: nobody among the contacts matched, the recipient selector came back empty, and no card was made.
- **Now the message shows with nobody chosen** (`modos/compose.mjs`; `scripts/modos_parts.py` accepts an empty `to`): its Choice offers every contact ("Choose…"), its draft is written as usual, and Send waits until someone is picked (sending with nobody is still refused). Single or multi-select still follows the selector's kind.
- Tests: Node 210, Python all pass (`tests/test_send.py` new).

### 10.29 The User Is Not a Thing When MODs Are Deduplicated (2026-11-18)

- **Found on ACEM**: "…Where is it? Draft a message to Alice on the weather…" chose FindMy, Send and Weather, then dropped Send as an alternative to FindMy (`view_alternatives: [["Send","FindMy"]]`): the request had put both in one question, and both read something about `user:me` (the belongings, the contacts), which the rule took for the same thing.
- **Fixed**: two MODs are two ways to show one need only when they read about the same thing in the space; the user (`user:…`) is left out of that comparison (`modos/pipeline.mjs`). ObjectStatus and IoTControl for "is the printer free?" still read the same printer and still dedupe.

### 10.30 The Heading's Form Is the Decision Model's, Not a Rule (2026-11-19)

- **Found on ACEM (speech)**: "…this weekend? Um, am I supposed to bring my umbrella with me? Should I bring my umbrella? … can you send a message to Alice…" got no Yes or No: the rule looked at the last question's opening words, and speech had run several sentences into one question that began "this weekend?". Speech to text also drops and misplaces question marks ("Where is my umbrella" came as "Whereas my umbrella."), so no rule on wording or punctuation can hold.
- **Now**: the request call (one Jev call, no new latency) also scores `yes_no`: of what the user wants to be told (not what they ask to be done), is the last such question answered by yes or no, judged by meaning (`modos/request.mjs`). Over .5, the text is written under Yes, No or Not sure and its title is held to it (`modos/text.mjs`); the decision is in the request's trace and part of the text's intent while typing. The `isYesNo` rule is removed.
- Measured with Jev, unpunctuated: "whats the weather this weekend um am i supposed to bring my umbrella with me" yes; the ACEM utterance yes; "whats the weather this weekend" no; "is it gonna rain this weekend where is my umbrella" yes (arguably no: the last question is where; the model read the rain question as the one to be told).

### 10.31 Not Done Yet (2026-11-17, in priority order)

1. **Placement module (4.5), the rest.** The view stack exists; still missing are the per-thing site allocator, `beside` clusters with occlusion and overlap checks (the Delegate message column can still cover the poster), and one solver shared by all MODs.
2. **Wayfinding picks the nearest door of the target room** by the user's straight-line distance, not by route length.
3. **Spec MODs** (Agenda, BookCompanion, StepGuide, LiveCoach, Reminder) are chosen and answer in text only. LiveCoach's `bodyArrow` is not in the library; Reminder has no time trigger.
4. **Vision Pro (later): every update since the web rebuild.** The cues, text forms, routing, message parts, MOD-declared UI and placement exist only in the web editor (`editor/src`); `visionos/` still renders the earlier parts and settings. Port all of it, ideally against the platform-neutral surface messages of §11 so both renderers read one format.
5. **Feeds and tailoring.** Weather and the rest use mock data (no real fetchers or refresh). The MODs tab can switch variants, settings, forks and knowledge, but there is no test loop yet; the Agent panel's old per-mod response settings should move into MOD settings.
6. **Small data issues.** In the Lab example retrieval also picks an unrelated poster; in the atlas mock items the brush's container is not in the layout, so FindMy cannot find it.
7. **User actions back to the agent (later; after A2UI).** Today a press goes straight to the device or the outbox (`/api/modos/devices`, `/api/modos/actions`) and the conversation never learns of it, so "a bit more" or "send it to Ryo instead" cannot follow. A2UI sends an `action` event (name + a context that may read data-model paths) to the agent, and `sendDataModel` can attach the surface's whole data model to it. ModOS should do the same: an Adjust or Interactive press becomes an event in the conversation's context, and the next request is answered knowing it.

## 11 Next: Structure and Data Apart, Progressive Rendering (Plan, after A2UI)

Reference: A2UI v1.0 (current), `specification/v1_0/docs/a2ui_protocol.md` and the TypeScript web core (`typescript/core/web_core/src/state/data-model.ts`, `surface-model.ts`, `processing/message-processor.ts`), repository `google/A2UI` at `0d3ebdc` (2026-11-17).

### 11.1 What A2UI Does

- **Four messages on one stream.** `createSurface` (a surface id, a catalog id, optionally the first components and data model), `updateComponents` (components to add or replace), `updateDataModel` (a JSON Pointer path and a value; upsert, `null` deletes, no path replaces all), `deleteSurface`.
- **Structure is a flat adjacency list.** Each component has an `id` and its type; containers name their children by id; the one with `id: root` mounts on the surface. Components may arrive in any order; the renderer keeps a map and builds the tree when `root` exists.
- **Data lives apart and is bound by path.** A property is a literal or `{"@path": "/flight/gate"}`. The renderer's data model keeps one signal per path; a write notifies the path, its ancestors and its descendants, so only the components reading those paths update. Lists bind to an array path with a template (relative paths per item).
- **Progressive rendering is part of the contract.** A missing child or an undefined path renders as a placeholder; it fills in when its message arrives.
- **Inputs are two-way but local.** A TextField or Slider writes its path in the renderer's data model at once (other components bound to it update), and nothing is sent until an `action` fires; the action's context reads the paths it needs.
- **Layout.** The agent (a model, or server code: "macros", a state machine) emits the tree with layout containers (Row, Column, List, Card, Tabs, Modal) and coarse hints (`justify`, `align`, `weight`, a List's `direction`); geometry is the native framework's (flex on the web). Choosing parts and arranging them are the same act, one output; there are no coordinates. `allowedParents` / `allowedChildren` constrain nesting.

### 11.2 How It Maps to ModOS

| A2UI | ModOS |
| --- | --- |
| surface | one answer (a question's parts): created once the MODs are chosen |
| catalog | the spatial UI library (`modos/spatial-ui`: cues, text forms, assets) |
| component (`id`, type, props) | a cue instance from a slot's declared `ui`, with its anchor (a thing, a place, the user) and props |
| data model, `@path` | the values the cues show and change: targets and states, device inputs and outputs (`/device/brightness`), task progress (`/job/done`), the draft (`/draft/body`), the forecast cursor, the text |
| `updateComponents` | stage 5: what the declarations and facts say to draw (a cue appears or goes when a `when` changes) |
| `updateDataModel` | Fill results, the text stream, device events, the user's own input |
| two-way input | Slider, Text Input, Date Picker, Playback write their path locally; Adjust sends on release, Interactive on Send |
| layout | not the agent's: placement (§4.5) from anchors in the room. Selection comes from the MOD declaration, arrangement from placement; ModOS keeps them apart on purpose |

Kept as is: MODs choose and fill; declarations choose cues by rule; no model writes the component tree.

### 11.3 Steps

1. **Message format and store.** Define ModOS surface messages after A2UI's envelope (`createSurface`, `updateComponents`, `updateDataModel`, `deleteSurface`; JSON Pointer bindings; catalog id `modos/spatial-ui`). The store keeps, per question, the component map, the data model and an ordered log of messages with their times (replays play the log). Parts as they are now go away, not kept beside it.
2. **Client data model.** A small data model with per-path subscriptions (notify the path, ancestors, descendants), and a surface that holds the component map and mounts cues as their messages arrive; placeholders for what is not there yet.
3. **Cues take data.** Each cue binds its props to paths and updates in place (`set`), instead of being rebuilt: Slider value, Progress Rail done/total, Text Input text, Status Pulse state, Gauge level, Date Picker / Playback cursor, the highlight targets.
4. **Renderers onto the surface,** one at a time, each checked on its clips: device controls (live device state; the slider writes `/device/<key>` and sends on release), the message column (the draft streams into Text Input with no rebuild), marks and guidance (targets and states), Weather's controls (cursor).
5. **Progressive rendering in the pipeline.** Emit as soon as each piece is known: after stage 1 and 2 the surface and what needs only the referent or the chosen MOD (the referent's mark); after Fill each MOD's cues and data; the text as it streams. Measure time to first cue against today on the reel's clips.
6. **Docs and Gallery.** Update §6 (pipeline), §4.4 (cues are data-bound), the code map in `AGENTS.md`; ask the Gallery's examples again (`npm run gallery`) and compare first-cue times.

Decided: ModOS borrows A2UI's architecture, not its wire format; no compatibility with A2UI is kept.

Open: the transport. Today the editor polls: it asks the server for the conversation again every 120 ms while a question runs (every 1 s otherwise), receives the whole conversation each time, and works out what changed. A stream (Server-Sent Events, or a WebSocket) would let the server push each message the moment the pipeline produces it, so each piece appears without waiting for the next poll, and only the new message travels. Polling is good enough to start; switch if the first-cue times show the wait.

## 12 Answer While Typing (branch `modos-live-input`, 2026-11-18)

A mode, switched by the button beside the ask box: the space answers while the question is still being typed, and keeps the answer in step with it. What shows grows as the question does, changes when it is said more exactly, and is corrected when it turns out to mean something else.

### 12.1 When to Ask Again: Breaks (no model)

`src/live-input.mjs`. A revision of the question goes out when a word is finished (a space after it) and when the user pauses, a pause being longer than their own rhythm: 2.5 times the median gap between their last 20 keystrokes, kept within 180 to 1200 ms. Neither punctuation nor a model decides it. Whether the intent is clear is not decided here but by the decision model's own scores (12.3).

### 12.2 Drafts in the Store

The first revision makes a question with status `drafting`; each later one replaces its text, frame and what the user looks at, and is kept in `revisions` (time, text, whether it was a pause) so the typing can be replayed. Enter asks the draft (`queued`, answered once more in full); clearing the box deletes it. The bridge takes the latest revision not yet taken; its trace starts again, so the pipeline view shows the latest one.

A part of a draft carries the revision it was made for. The revision being answered finishes even when the user has typed on, and the bridge then takes the newest text, skipping the ones between: dropping work for every newer revision starved a fast typist (at 110 ms a letter nothing showed until they stopped). Only a part for a revision older than the one taken since is refused (409); the bridge stops when the draft is asked or dropped. A draft's part is identified by its kind and its MOD (`part_key`: `highlight:objectstatus`), replaced in place when it changes and withdrawn (`/api/agent/responses/retract`) when it goes. Response ids are never given twice. A device's asked change is only previewed while typing (`resolve_control(preview)`: what the device would become, nothing done); Enter does it.

### 12.3 The Pipeline Reconciles

`runModos({live})` runs the same stages on each revision, with the state of the last one (kept by the bridge per question):

- **A MOD shows once its need is clear**: scored .5 or more in two revisions in a row, or .85 in one. Once shown, it stays while it scores .35 or more, so a word half typed does not make it blink. On a pause and on Enter the plain rule (.5) decides: the user's words are then what they mean.
- **The request is scored as unfinished** while typing: its last part may stop mid-sentence and is judged by the need its words show so far. Questions split at "?" and "!" with or without a space after ("umbrella?where is it").
- **Parts are sent only when they change**, by key, and the ones a MOD no longer has, or of a MOD no longer chosen, are withdrawn. Fills are cached by the MOD, the words, the referent and what it reads.
- **The text is written on a pause**, once per wording and set of MODs, and again on Enter if either changed. A text written for other MODs is withdrawn at once. A clarifying question ("which one?") waits for Enter.

### 12.4 Guidance Must Be Seen

Found on the ACEM recording: FindMy chose the umbrella (shelf 1, in the lab) and drew its Floor Path, but the user faced a door and none of the path was in view, so nothing showed. The cue host now knows whether any of the path is in view (`path.in_view`); FindMy and Wayfinding declare Arrow Ahead when the target is in another room and the path is not in view, pointing a couple of metres along the way and named for the target. Once the path comes into view the arrow goes: Arrow Ahead and Floor Path are still never seen together.

### 12.5 Measured: `demos/live-replay.mjs`

Types a question again into a recording through the server and its bridge (a draft typed earlier at its own times, or text at a typing rate) and logs, per revision, the MODs' scores and each part as it shows, changes and goes. On PRL_2:

- "where are my headphones": "where" Wayfinding .53 (once: not shown), "where are my" FindMy .61, "headphones" FindMy .96, shown with the headphones found.
- "where is my umbrella, is it gonna rain tonight": FindMy shows when "umbrella" is typed, Weather when "rain" is; both stay; the text comes on the pause.
- "where is the umbrella, i mean the kitchen": Wayfinding is added on the correction (.94), but FindMy stays at .5 (the model still reads the umbrella as asked).

### 12.6 Text, Headings, Lines on the Timeline (2026-11-18)

- **No text with a fact missing.** While typing, the text is written only once the intent is clear and every chosen MOD that shows something has a part with what it needs (FindMy with no item yet, `{status: not_found}`, is not); it is written when the intent first becomes clear or changes (another MOD, another question) and on a pause; a text whose intent changed is withdrawn at once.
- **The heading answers the last question the user wants to be told**: with "what's the weather this weekend? should I bring my umbrella?", Yes, No or Not sure (the request's `yes_no`, §10.30).
- **Leaving the mode asks the question typed** (its icon, as Enter); the box empty, nothing is kept.
- **A typed question is a line on the timeline**, from where typing began (its first revision) to where it was asked; a draft's moment moves with its latest revision. Picked like a dot: × deletes it, ★ adds it to the Gallery's category Answer while typing with its revisions, typed again by `npm run gallery`.
- **The Gallery plays.** Its example view has no ask box and its dots only replay; Try the Demo opens the Demo on the example's recording at its moment. Playback runs at 0.5× by default.

### 12.8 Speech to Text (2026-11-18)

- **The microphone** in the ask box asks by voice. Its audio streams to Doubao's streaming recognition (Volcano Engine, `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel`) through a relay, `scripts/asr-relay.mjs`: a browser cannot set the keys a WebSocket needs, and the keys stay out of the browser. The relay is Node with no dependencies (its own WebSocket and zlib), on 127.0.0.1 only, started by the editor's server when first needed and stopped with it; it reads `doubaoAsr` from `agent-config.local.json`.
- **The protocol** (`scripts/doubao-asr.mjs`): a v1 4-byte header, gzip payloads, a full client request (16 kHz mono 16-bit PCM, `bigmodel`, punctuation and inverse text normalization, sentences with `definite`, 800 ms of silence ending one), then audio packets of 200 ms, the last one flagged.
- **In the editor** (`src/speech-input.mjs`): the browser resamples the microphone to 16 kHz in an AudioWorklet and posts the packets; the text comes back as server-sent events and fills the box as it grows. The microphone and Answer while typing combine: the microphone alone only writes into the box, and nothing is sent until the user asks; Answer while typing alone answers what is typed; both answer what is said, as it is said: a revision whenever the text grows (at most every 300 ms), a pause each time a sentence becomes final, and the question asked when the microphone is pressed again.

### 12.9 A Typed Question Replays as It Happened (2026-11-18)

- **Its line plays, not held.** Picked or reached in playback, a typed question's line on the timeline is played from its head on the clock of its revisions (`src/typed-replay.mjs`): the video moves as it moved while the question was typed or spoken (each revision's `t`, linearly in between), the caption shows what had been said by then (its last two lines), and the surface grows as it grew. There is no hold at its end.
- **Past the video.** When the video had stopped (paused, or at the recording's end) while the user spoke on and the answer kept coming, the replay stays on that frame and goes on: until the last part, then reading time (`read_s`). Only then does playback go on.
- **The surface as it was.** Each part shows from when it was made (`created`) until it left the surface: a part replaced while typing, or withdrawn, is kept on its question with the moment it left (`withdrawn`, `withdrawn_at`, `scripts/agent_store.py _withdraw`), returned apart by `/api/agent/status` (`withdrawn`, never among the live responses) and shown only while that question is replayed (`typedReady`); streamed text shows as written by then. Questions typed before this keep only their last parts, so their replays show those parts at the moments they were made.
- **Scrubbed or paused inside a line**, the caption and surface are those of that moment (`eAt(t)`: the first moment the video reached t); Play goes on from there.

### 12.10 No "Answer unavailable" While Typing (2026-11-18)

- **Found on ACEM**: "…this weekend. Um, am I supposed to bring my umbrella with me?" showed "Answer unavailable" until the question was asked. The last sentence made it a yes/no question, so a partial heading other than Yes, No or Not sure is held back; the first partial then had neither heading nor body, the server refused the empty text, and the stream ended as failed, a text no later revision replaced.
- **Fixed**: a partial with nothing to show yet is not sent (`modos/text.mjs` streamAnswer); and while typing, a text that fails anyway is withdrawn and written again with the next revision (`modos/pipeline.mjs`), so "Answer unavailable" is never left in view.
- `demos/live-replay.mjs --source <recording>` types a draft from another recording again (to replay it with a bridge whose log one can read).

### 12.11 A Message Keeps Its Draft While the User Speaks On (2026-11-18)

- **Found on ACEM**: "…OK. Send a message to Alice. About our hiking plan during the weekend and the weather during the weekend." showed the message without its words ("writing…") for 35 s, until it was asked. Not the model (the draft took 1.6 s once asked) and not the video's end (it ended 30 s in; revisions went on at its last frame and were answered). Two causes:
  - A draft is written on a pause or on Enter. One was written at a pause (42.6 s), then the next revision, not a pause, sent the message again without it.
  - Spoken, the last sentence becoming final made no pause: a revision went only when the words grew, and they had not.
- **Fixed**: between pauses the message keeps the draft last written for its MOD (`modos/pipeline.mjs`, `live.state.drafts[mod]`), written again on the next pause or Enter; and a sentence that becomes final is a pause revision even when its words did not change (`src/app.mjs` speech).

### 12.12 The Pipeline Replays With Its Typing (2026-11-18)

- A typed question's pipeline was only its last run (each revision's trace replaced the one before). Now each run is kept with the revision it answered and when it began (`traces`, `run_at`; `GET /api/agent/questions/runs`, not in the polled status), and while a typed question is replayed or scrubbed the pipeline view shows the run under way at that moment, as far as it had gone, with the question as said by then. Questions typed before keep one run, from when they were asked.

### 12.13 Lazy Updates: Each Piece Recomputed and Redrawn Only When What It Rests On Changed (2026-11-18)

A revision often clarifies one piece and leaves the rest as it was: "Send a message to Alice about our hiking plan" then "…and the weather during the weekend" keeps the MODs, the recipient and every cue; only the message's words change. Each revision used to run every stage again and replace each part that differed in any field, so the message column was rebuilt (its Choice, Text Input and Send) for a new draft. Now one data path, the same for every MOD and every cue:

1. **The pipeline recomputes a piece only when what it reads changed** (`modos/pipeline.mjs`, `modos/fill.mjs`, `modos/selectors.mjs`).
   - Request (one Jev call) runs each revision: it is what says what changed.
   - Fill, per MOD: keyed by that MOD's own questions (the ones it was chosen for), the referent and its context info, not the whole utterance. "…and the weather" changes Send's sentence, not Weather's question.
   - Fill, per selector: each selector says what its answer rests on (`evidence`): contacts the names said (by rule), the others the MOD's own questions, the referent and what is pointed at. Only selectors whose evidence changed are asked in that MOD's call; the others keep their answers (`live.state.selectors`).
   - The message's draft: keyed by its MOD's own questions and selection; written on a pause or Enter only when that key changed; the last one stays meanwhile.
   - Each revision traces what it kept and updated (`view_live {kept, updated}`, `{kept: {fill | draft}}`, a fill's `kept` selectors).
2. **A part keeps its identity** (`scripts/agent_store.py`): a part is one per kind and MOD on its question's surface (`part_key`). Posted again with new data, it is the same part (the same id, `updated_at`), and the version before is kept with when it left (`withdrawn`, for replays); posted again with the same data, nothing happens. The `upsert` flag is gone: every post is this. A replayed version shows from its own `updated_at`; an answer's identity is its first part's, whichever version shows (`part_id` on withdrawn versions).
3. **Every renderer reconciles its cues by key** (`src/spatial-ui/cue-set.mjs`): it says which cues should stand and what each is drawn from (`{key, props, make}`); a cue whose props are the same is kept, one that takes new data in place (`set`) gets it, one that cannot is made again alone, and one no longer wanted goes. Used by the message (Choice, AR Photo, Text Input, Send; its Mark), a device's controls (a cue per value; what stacks above the device as one), marks and guidance (`src/cue-host.mjs`), Weather's Date Picker and Playback, info answers' Marks and the Text Arrows. The old whole-scene rebuilds are gone.
4. **Cues that take new data in place**: Text Input (the words in common stay; the rest is written in, 90 characters a second; the user's own typing shows at once; the column is laid out again every frame as it grows) and Slider (a new value, or the device's state after a press, with no rebuild).
5. **Measured** (`demos/live-replay.mjs`, the hiking message, 23 revisions): the recipient was not asked again 7 times, Send's fill was reused whole 4 times and Weather's 12 times, the draft was written 3 times (kept once); replayed, the message's column was made once, its two redrafts went into the Text Input in place, and Choice and Send were kept throughout (`actionCard.stats`).
6. **A question is reached within half a frame** (`FRAME_EPS`, `src/response-parts.mjs`): video frames do not fall on a question's exact moment, and an answer must not vanish for a frame (its cues would be cleared and made again).

7. **An answer with no words is not left "writing"**: Send alone has no answer text (its message is in its card), but its part kept room for words to come, so the answer never finished writing and the Gallery's still was never taken. With the question answered and no words, there is nothing left to write (`src/agent.mjs` write). Send's four examples asked again: each has its draft.

Not yet: more cues with `set` (Playback steps, Choice values, Progress Rail, Gauge are made again alone when their data changes); the Vocabulary page still rebuilds a tile's overlay on a press.

### 12.14 Speech: Two Passes, Sentences That Do Not Break on a Hesitation (2026-11-19)

- **Two passes** (`bigmodel_async`, `enable_nonstream`, `scripts/asr-relay.mjs`): the words stream as they are said (the live revisions follow them), and each sentence, once said, is recognized again by Doubao's non-streaming model and only then is final (`definite`: the pause revision, when the text and the draft are written).
- **A sentence ends after 1.2 s of silence** (`end_window_size`, `doubaoAsr.endWindowMs`). Measured on synthetic speech with pauses of 0.6, 1.0 and 1.4 s: at 800 ms (before) a one-second hesitation made "Um." a sentence of its own (three sentences); at 1200 ms two (the real break at 1.4 s); at 1600 ms one; with no window (semantic segmentation) three.
- **No language is set**: Doubao's `language` (`en-US`) did not keep the text English: Chinese speech still came out in Chinese, with the 1.0 and 2.0 models (`volc.seedasr.sauc.duration`, open to this account) and every endpoint, so the option is removed. English speech comes out English either way. No hotwords.

### 12.15 Hold Space to Speak; a Spoken Question Keeps Its Voice (2026-11-19)

- **The ask box**: the field and the microphone in the capsule; Answer while typing beside it, on its right; no Ask button (Enter asks a typed question).
- **Hold Space**: a tap plays or pauses; held 250 ms, Space turns Answer while typing and the microphone on together, and let go, asks what was said at once; the box is empty again and the mode is back as it was (`src/app.mjs`, `speakWithSpace`).
- **The voice is kept**: what the microphone heard (`src/speech-input.mjs` `recording`, a 16 kHz WAV) goes with the question once asked (`POST /api/agent/questions/audio`; `agent/audio/<id>.wav` in the recording's folder, local only; `q.audio = {file, at}`, `at` when it began against the question). It is deleted with its question or conversation unless another (a Gallery copy) still refers to it.
- **Replays play it in step**: while a spoken question's line plays (12.9), its recording plays at `e − at`, following pauses and seeks.
- **Recognize again in replays** (Input › Speech, off by default): replaying a spoken question plays its recording through speech recognition again, from where it began, with Answer while typing on, as if said again there; once it has played, what was recognized is asked: a new question with its own answer and the same recording. For comparing recognition settings and the pipeline on the same words.
- Checked headlessly with the speech as a fake microphone: held 13 s and let go, the question was asked with its 7 revisions, the box emptied, the recording kept; with the switch on, the replay asked it again as a new question.

### 12.16 Speaking With Space: From the First Word, Words in the Row, Recomputations Marked (2026-11-19)

- **From the first word**: the start waited on the relay, the microphone, the recognition's session and the audio worklet one after another (and only after the 250 ms hold), so the first words were lost. Now listening starts when Space goes down, the microphone and the worklet are readied while the recognition opens, and what is heard waits in a buffer until it can be sent (`src/speech-input.mjs`); the relay is readied when the editor connects (`warm`). A tap (under 250 ms) is dropped and plays or pauses as before.
- **No send step**: let go, the question is finished there (the draft asked, with its recording), without holding the video or showing anything; the row is the empty ask box again (`askSpoken`). Recognize again in replays finishes the same way.
- **The words in the row**: held, the ask row (field, microphone, Answer while typing) gives way to the words as they are said, their end in view.
- **Recomputations marked on the words** (`src/recompute-marks.mjs`, from the draft's runs, read at most every 300 ms): each revision that changed something is marked at the end of the words it answered: a cyan bar where the MODs changed (one came or went), a short light bar where a part got new data (a MOD filled again, its cues updated), a dot where the answer's text or a message's draft was written again. A revision that kept everything is not marked.
- Checked headlessly with a fake microphone: the first words came in full ("What's the weather this weekend?"), the row showed the words with ten marks, and let go, the video played on, the question was answered and its recording kept.

### 12.17 Nothing Cut From a Spoken Question; the Row Replays (2026-11-19)

- **The microphone stays open** once the editor connects (released while the page is hidden) and keeps the last 0.6 s: a question begins where the user began, a little before Space went down, and no time is lost opening it (`src/speech-input.mjs` `prime`, `PREROLL`). Let go, it hears on for 0.5 s (`TAIL_MS`): the last word is often still being said.
- **A recording is replayed whole**: it begins before the first revision (its `at` is negative) and may end after the last part, and the line of a spoken question now runs from its first sound to its last (`src/typed-replay.mjs`; `q.audio.duration`, from the WAV, filled in for recordings kept before). The head had been skipped (the line began at the first revision) and the tail stopped (it ended at the last part), though the text had it all.
- **No reading pause after a typed line**: the video goes on once it is answered.
- **The row replays**: while a typed or spoken question's line plays or is scrubbed, the ask row shows its words and marks as they were at that moment. The row is left-aligned; when longer than the row, its end is kept in view.
- Checked headlessly: held 2 s, the recording was 3.1 s (pre-roll and tail included); replayed, the line began 2.57 s before the first revision and the row followed the words.

### 12.18 A Steady View While Words Come; the Video Moves From the First Sound (2026-11-19)

- **The caption has a fixed band**: room for two caption lines at the bottom of the view, kept whether or not a caption shows and however many lines it has (`src/agent.mjs` `captionTop`, `CAPTION_BAND_PX`). Floating Text and the view stack stand on its top, so they no longer move as a question's words come, grow a line or go. This replaces "lower once the caption is gone" (10.18).
- **The video moves from the first sound**: a spoken question keeps where the video was when listening began (`q.audio.video = {t, at}`), and its replay moves the video from there to the first revision (it had waited there). A line's replay now starts at its own first frame (playback only moves the video forward, so starting at the first revision had stopped it).
- **The voice plays out** when the line ends, and Space is heard 0.8 s after it is let go.
- **Fixes**: storing a recording now holds the store's lock (without it the request failed, so no recording was kept, and a conversation could be written twice at once); a replay takes the question as it is now (a timeline marker could hold it from before its recording came).

### 12.19 One Clock for a Spoken Question's Replay; the Line From Space Down to Space Up (2026-11-19)

- **One clock**: a replay runs on real time e since the question began. The video is where it was at e (from where it was when Space went down, through each revision's frame, to where it was when Space was let go, then on at the speed it had then: `q.audio.video = {t, at, t_end, at_end, rate}`, `rate` 0 when paused; no further than the recording's end). The voice, the words and the parts are each where they were at e. So the replay is the recording's own rhythm: the words come as late after the voice as they came then (1 to 2 s with Doubao's two passes in the recording measured).
- **The voice was not in step**: the editor's server answers no byte ranges, so the browser could not seek in a recording (every seek fell back to its start) and the replay kept pulling the voice back, leaving the words ahead. A recording is now fetched whole and played from memory (a Blob), loaded before its replay starts, and kept within 0.1 s of its place. Measured on a 27 s recording: the voice stays within 0.05 s.
- **The line on the timeline** runs from where the video was when Space went down to where it was when Space was let go (before, from the first words recognized to the question's moment).
- **A steady view stack**: while one question's answer stands, the stack's base (the top of its Floating Text, else the caption band) only rises, when the text grows past it; it never falls back as the text is written again, withdrawn or re-fitted, so the controls and the message above it do not jump. A new answer, or another view size, starts it anew (`src/agent.mjs` `viewTop`).
- **The stack's parts have one size**: every part of the view stack (Date Picker and Playback, a device's controls, a message) is drawn at one fixed size (`STACK.scale`, between the full size it had and the size it shrank to), whatever else stands with it. A stack that would run past the view's top (`STACK.top`) is lowered until it fits, its parts keeping their size (`src/cluster-placement.mjs` `keepInView`). (Shrinking the whole stack to fit was tried first: a message coming in made the Date Picker smaller, which made no sense.)
- **A message has a fixed height**: its Text Input is six lines high whatever its text (`cues.textInput` `rows`), so the draft being written, rewritten or edited never moves or resizes anything around it (before, the field grew with its text, and the fitted stack shrank everything with it). A longer text shows its end while written or edited, else its beginning, ending in an ellipsis.
- **The words row wraps**: the ask row's words (spoken, or replayed) wrap onto up to five lines; longer, the newest stay in view and the lines above fade.
- **The editor fills the window, one frame of lines**: no page scroll; the columns run from the window's top to its bottom, so the vertical lines (the recorded camera | the Digital Twin, the Digital Twin | the side panel) run its whole height; the agent log takes the rest of its column and scrolls inside it (its Log | Pipeline always in view), and its line reaches the vertical line (or the window's edge) on both sides; the side panel's tabs are one bar from its line to the window's right edge, their separators its whole height. The line between the Digital Twin and the side panel is a handle too (the side panel at least 260 px, at most half the window; double-click resets 280 px; remembered).
- **The User's view**: the recorded camera's column is titled User's view; Answer while typing's halo glows in from that whole column's edge (not round the camera alone); where the user is and looks is a small tag at the column's head, left of its buttons, in the full window too; the words row under the timeline has no frame or background.
- **Names**: three processes, each named for what it is (they were all Spatial Take): **modos-system**, the editor and its API (8766; the npm package, the server's banner); **modos-speech**, the speech relay the editor starts (8767; its keys stay there); **modos-agent**, the agent bridge (no port: it asks the editor's API). The server and the bridge each set their terminal's title to their name, so the tab the agent command runs in is not named after the editor's. The editor's page is titled ModOS.

### 12.20 The Text Is a Slot: Written for What Is Asked to Be Told, Dimmed When It No Longer Answers (2026-11-19)

Benchmark (the saved Answer while typing questions, replayed through the live pipeline by `demos/live-replay.mjs`, which now also logs a text written again in place, dimmed, or answering again): the text was withdrawn and written anew on almost every pause, 9 times in q27, mostly the same words, also while only a message was being spoken.

- **Know or do**: the request call judges for each sentence whether it wants to be told something or only asks for something to be done (`know`), and whether it is a yes-or-no question (`yesno`), from the meaning (modos/request.mjs). A request that only asks for something to be done (send a message, turn something on) gets no text: what it does shows it.
- **The newest only, briefly**: the text answers only the newest sentence that wants to be told something (the user cannot take in every answer again each time): a short heading (Yes, No or Not sure for a yes-or-no question) and one sentence of at most about 12 words (`context.asked`, modos/text.mjs). It is written again only when that sentence, the MODs that serve it or its yes-or-no form change (its words compared as words: speech to text's cuts and case do not count).
- **Dimmed, not gone**: a revision that changes what the text answers but writes nothing new leaves it in view, dimmed (`stale_at` on the part, POST /api/agent/responses/stale; drawn at 0.4; replayed from that moment). A new text takes its place in place: the same part, a new stream (scripts/agent_store.py `_add_stream`; the text before is kept as a version for replays), and in view the old one fades out where it stood (0.3 s) while the new one is written there. At the question's end, a text with nothing left to answer is withdrawn.
- **Yes and No are marked**: a Yes heading has a green check, a No a red cross, Not sure none; by rule from the heading's words, drawn on a layer of its own so the text's legibility tint does not change their colour (src/agent.mjs `drawMark`, `syncMark`).
- **Fix**: a MOD with nothing to show (no part) no longer holds the text back; only a part that says it found nothing does.

### 12.21 Themes: What the User Speaks Of, Across Sentences and Questions (2026-11-19)

Decided with the user before building; modos/themes.mjs.

- **A theme** is a need or topic the user speaks of (the weekend's weather and the umbrella; a message to Alice), not a run of consecutive words: its sentences may be apart, one sentence may speak of two. The theme is the identity; its MOD is how it is shown and may change (a replace is a theme whose MOD changed). Themes belong to the conversation: a later question that speaks of the weather returns to the weather theme. A theme ends when the user says so, or when it has not been spoken of for 3 questions or 2 minutes, whichever comes first (`COOL`).
- **ThemeRouter**: in the request call (with grounding), each new or changed sentence (only those: the routes are kept across revisions) is placed: which earlier request it continues (the live themes side by side, each shown by its words and what it is: to be told or to have something done, and the MODs that show it), which it refers to or uses as a request of its own, whether it adds anything, whether it tells to stop a theme; with what it asks and needs as a new theme would. The sentence said right before it is given with it (speech to text cuts one sentence into pieces). No cap on the number of sentences.
- **What is redone follows from what changed**: a theme that took a sentence is judged again on all its words (its about and MOD scores), in a second call, only then and only for words not judged before; a fill asks again only the selectors whose evidence changed. There is no separate judgment of what a sentence does to its theme.
- **Focus**: the themes of what is being said now (a sentence's themes and those it refers to); the others of the question are background. Steadied: a new focus is taken once it holds for two revisions, or at once on a pause or the question's end. Every part carries the fact (`theme: {ids, focus}`) for its MOD's UI rules; how background steps aside is future work. The Pipeline view marks the focus theme.
- **Storage**: the conversation keeps its theme book (GET/POST /api/agent/themes); the bridge reads it before a question and writes it after each run; a question answered again starts from the book without its own sentences. Bridge questions carry their number in the conversation (`n`), by which themes cool.
- **Benchmark** (q36, the Gallery's newest Answer while typing example): two themes, the weather and umbrella, and the message to Alice that refers to it; through the whole message the text stays as it is (one brief dim). q30 (the other Gallery example): one rewrite at "this weekend", then nothing changes while the message is spoken. q25 still shows speech to text's pieces: "I mean, Alice and Rebecca." begins a second message theme, and "And the weather." is read as a question; the punctuation step (§12.7) is next.
- **How the router was found**: one score per theme ("does it speak of it") put every sentence in one theme (a message about the umbrella speaks of it); a choice per theme between the same need, a request of its own that mentions it, or neither split the message well but not the corrections; one choice among the themes side by side, each shown by what it is, does both best on these benchmarks. Kept general: no rule on wording.

### 12.22 A Line Picked Offers Replay and Rerun (2026-11-19)

- Picked on the timeline, a typed or spoken question's line no longer replays at once: it offers **Replay** (as it happened, §12.19) and, for a spoken one, **Rerun**: its recording is heard again by speech recognition and answered by the pipeline as they are now, from where it began, and the new question takes the old one's place (the old one is deleted). Its line runs over the recording. This replaces the Input panel's "Recognize again in replays" switch (removed), which asked a new question beside the old one.
- The marks on the words (§12.16) read the new pipeline as they did: a MOD come or gone, a part with new data, a text written again (now in place). A text dimmed is not a recomputation and is not marked.

### 12.23 Attention Drawn: Background Parts Fainter and Greyer; Recomputations as Icons (2026-11-20)

- **Attention effects** (src/attention.mjs): a part whose theme is not the user's focus (§12.21, its `theme.focus`) is drawn as background: more transparent (0.45 of its opacity) and less saturated (0.3), easing over 0.45 s either way. The effect is applied to whatever a renderer drew, without the renderer knowing: right before an object is drawn (after its renderer set it for the frame) its opacity and saturation are changed (saturation at the end of the material's own shader), and right after they are put back, so no renderer reads them and nothing compounds. The states and what they do are a table (`EFFECTS`): other representations of attention (smaller, stepping aside, blurred) are new entries there. Applied to the highlight and FindMy cues, a device's controls, a message, and Weather (its ambient effect, Date Picker and Playback); the presentation says per kind whether its theme is the focus (`focus`). The text is not dimmed by it (it answers the newest question, §12.20).
- **Marks on the words** (§12.16) are Lucide icons (lucide-static 1.77.0, inlined) in dark grey circles: a MOD came or went, layout-grid-plus in light pink; a part got new data, braces in light orange; the text or a draft was written again, pencil-sparkles in light green.

### 12.24 Background Smaller and Newest Lowest; Steady Facts; a Place the Words Name (2026-11-20)

From the user's test q56 (atlas_rec_1).
- **Background further**: a background part is now 0.28 of its opacity, 0.12 of its saturation and, on the view stack, 0.7 of its size (`EFFECTS.background.scale`, read by the placers through `attention.scaleOf`), all easing together.
- **Newest lowest**: the view stack puts what came later below what came earlier (nearest the text), by when each kind's part first showed (the presentation's `since`).
- **FindMy's arrows flickered** (video 10.97 to 11.01 s): the response feeding them never dropped out (logged frame by frame); the facts the arrows hang on, whether any of the path is in view and which room the user is in, flipped at each 250 ms check while the view sat at an edge, switching Floor Path and Arrow Ahead back and forth. Each view fact is now taken only once its new value has held for 0.5 s (src/steady-facts.mjs, in src/cue-host.mjs).
- **"Is the printer in my lab available?" asked from the corridor** had no answer: its context was looked up only in the corridor (what it is about: here), and the printer is in the lab. What a sentence or theme is about may now be a place the words name, not where the user is (each other place of the twin is an option), and context is looked up for every reading with real weight (0.3 or more): the model was torn between the corridor and the lab (0.57 and 0.39). Asked again from the same spot: ObjectStatus found the printer, "No: the printer is in use", and highlighted it.
- **The 6.62 s answer** ("Yes: bring an umbrella …") is the text slot answering the newest question that wants to be told something (§12.20), written at the pause after "am I supposed to bring my umbrella with me?".

### 12.25 A Yes or No Heading First; Days as Spans; No Stale Text Left (2026-11-20)

- **The heading leads**: a yes-or-no answer is shown only once its heading is Yes, No or Not sure; never its words without it (the model may write another title first and the yes or no only at the end: then the answer shows whole at the end). Before, its body streamed with an empty heading (the test said so), which is what showed at 6.61 s of q56: "Bring an umbrella …" with no Yes.
- **Days as a stretch**: "What's the weather this week?" (q66) found no days: each day was scored on its own, 0.29 to 0.44, under .5. Days asked as a stretch are now one choice of its first and last day (and whether they are a stretch or apart); days apart ("today or Saturday?") are still judged one by one. A fixed list of spans (today, this weekend, this week …) was tried first and dropped: any stretch ("the next three days", "Monday to Wednesday") is covered this way. Each day also carries its week in the words people use (this week, this weekend, the last day of this week, next week): without them the model ended "this week" today. Asked live: this week Fri to Sun, next week Mon to Sun, the next three days Fri to Sun, this weekend Sat and Sun, Monday to Wednesday, today or Saturday, tomorrow (modos/selectors.mjs).
- **A yes or no heading is held**: when the answer's heading form is Yes, No or Not sure, the answer's schema only allows those three titles (scripts/answer-contract.mjs `schemaFor`), so it is never another title first. The yes-or-no judgment knows a request put politely as a question ("can you send …") is not one, and "can you tell me whether …" asks what follows.
- **No stale text left**: a text that failed (here because no part was left to host it) is taken away also at the question's end, not left dimmed answering what was asked before.
- **A Rerun heard two sources at once** (found 2026-11-20): the microphone stays open between questions, and while a recording played for a Rerun both fed the recognition, their 128-sample frames interleaved in arrival order: a stream twice as long (a Rerun's recording was exactly twice its original: 144.48 s for 72.24 s), so the words came out broken (q56 became q65: "Are there. During this weekend. Tell me I supposed to bring. Is it?"). Now only the source being heard is taken (src/speech-input.mjs `source`); the microphone keeps its pre-roll meanwhile. The original recording of q56 was deleted with it (a Rerun replaces the question); the frames alternate, so it was recovered from q65's (the odd frames, the same within rounding as the original) and is now q65's recording, to be rerun.

### 12.26 Here Is the Area; a Message Edited, Not Written Anew; Voices Ready (2026-11-20)

From the user's test q81 (atlas_rec_1).
- **Here is the area**: "Can you check the printer status?" from the Lab corridor found nothing: the corridor has no printer; the lab beside it has. The twin says the corridor is the lab's (both carry the same information, the Programmable Reality Lab: "the lab" means either). Here is now the area: the places in view and those that carry the same information as one of them (modos/context-request.mjs `hereArea`); a place the words name (§12.24) is any other. Asked again from the corridor: the lab printer, "Printer Paused: printing is currently paused at page seven", with its highlight and controls.
- **A message edited**: while a message is being said, each pause wrote its draft anew. The draft writer is now given the draft before (`previous_draft`) and edits it: its words kept where they still hold, only what the request now asks added or changed, written anew only when what the message is changed. With the Text Input writing in only what differs, an addition shows as one. q81 again: the weather sentence kept word for word, "Any update on our hiking plan next week?" added.
- **Voices ready**: a spoken question's recording is fetched when its conversation's questions arrive, not when playback reaches its line (its beginning was lost while it loaded). A replay from the line's Replay button played q81's voice to its end (58.84 of 58.91 s).

### 12.27 A New Theme Comes in Focus; the Text Steps Back With Its Theme (2026-11-20)

From the user's test (q81, at 4.49 s: the message was being spoken, yet it was dim and the weather's text bright).
- **A new theme comes in focus**: the message appeared in the revision before a pause and the focus waited for a second revision (§12.21), so it was born background; the pause then wrote its draft before its part was sent again, about 2 s later. A theme that has only just come has nothing to flicker against: it takes the focus at once; the steadying stays for moving between themes already in view.
- **The text steps back with its theme**: the text answers the newest sentence that wants to be told something (§12.20); when the user has moved on (to a message), that theme is background and the text now is too (src/attention.mjs, as the other parts). The text part carries its theme and whether it is the focus from when it is written; later changes are logged on it (`focus_log`, POST /api/agent/responses/focus), so a replay shows each moment; it follows only while it answers the newest sentence. Replayed q81: the message in focus from its first version, the weather and its text background once the message is spoken.

### 12.28 A Rerun Replaces Only Once Answered; Ids Never Given Again; Recordings Known by What They Are (2026-11-20)

From the user's session: a Rerun showed nothing and the original was gone; they deleted the Rerun's question and spoke again; the new question's replay played the Rerun's recording.
- **Ids never given again**: deleting a conversation kept a high-water mark of question ids, deleting one question did not, so the next question took the deleted one's id (87) and its recording's file name (`87.wav`). Deleting a question now passes the mark too (scripts/agent_store.py).
- **Recordings known by what they are**: the editor held a recording by its file's address only, so the new 87.wav was never fetched: the Rerun's audio, held from before, played. A recording is now held by its file, when it began and how long it is (src/app.mjs `voiceKey`), and fetched without the browser's cache.
- **A Rerun replaces only once answered**: the question it came from is deleted only when the new one is answered; when nothing is recognized or the new one fails, it stays.

### 12.29 A MOD Answers the Theme Being Spoken Of; the Focus Is a Moment (2026-11-20)

From the user's session: "What's the weather? This week. No, I mean next week. … Am I supposed to bring my umbrella with me today?" kept Weather on next week, and Playback did not open at today's rain.
- **A MOD's selectors answer its theme being spoken of now**: the fill was given the whole utterance as `user_question` (the MOD's own themes were only its cache key), so "this week, next week, the weekend, today" were one question and the model kept next week. A MOD's fill now answers its theme in focus (else the one said last), and its other themes come as context (`said_before`: where they differ, what is asked now decides) (modos/pipeline.mjs `askedOf`, modos/fill.mjs). This holds for every MOD's selectors (days, the item to find, recipients). A MOD has one part per question, so when two of its themes ask for different things it shows the one the user is on, and follows the focus back.
- **A theme the user stopped leaves the question**: "No, I mean next week" ended "This week" but the ended theme stayed among the question's themes, still read by the MOD and the text (modos/themes.mjs `place`).
- **The focus is a moment, not a period**: where Playback opens was chosen among periods, whose summary hides what happens inside them (a clear morning with thunder showers at 11:00). Each period is now shown with its moments, and a second choice in the same call picks the time of day; the first one from now on when the user asks whether something happens or whether to prepare for it (modos/selectors.mjs). The moments themselves (288 in a month's forecast) are more than one choice holds: offered as one list, the focus was not asked at all. No rule for rain or umbrellas: the timeseries selector of every MOD.
- **A deleted question leaves the themes**: its sentences stayed in the conversation's theme book, so a Rerun's question joined the themes of the one it replaced and its sentences appeared twice. Deleting a question takes its sentences out (a theme left with none goes), and the book is read with only the conversation's questions in it (scripts/agent_store.py `_book_of`).
- Tested on the user's recording (2026-11-20 00:36:39, Rerun, q90): Weather shows next week, then today once the umbrella is asked about; Playback opens at 21:00 Rain showers (time.local was 15:20, so the 11:00 thunder showers had passed); Yes heading.
- Not changed: a message about the weather (Send) writes from the whole forecast and its own words, not from what Weather shows.

### 12.30 Writing Shown: a Ball Breathes Left of the Text (2026-11-20)

From the user: while the language model writes something new for the text, a white ball breathes at its left. Between a text begun anew and its first words (about a second or two) the old text was only dimmed, and nothing said a new one was coming.
- **The ball**: white, bright, breathing (1.6 s), at the left of the text's first line; at full brightness while the text it replaces is dimmed; the question's waiting dot's look (src/agent.mjs `syncWriting`). It shows from when a text is begun (anew, or the first time: its stream) until its stream ends, so also while the words stream in. Nothing shows before a first text exists: there is no text to stand beside.
- **One fact, kept for replays**: the text part carries `writing` {from, to}: opened when the pipeline begins a write (POST /api/agent/responses/writing, `live.writing`) or when its stream begins, closed when the stream completes or fails, or when a later revision does not go on with the write (scripts/agent_store.py `mark_writing`). A replay shows the ball at the moments it showed (src/response-parts.mjs `text_writing`); a version replaced keeps the window that was open when it was replaced, so the ball stays through the crossfade.

### 12.31 The Decision Record: the Pipeline's Raw Data; Recompute Every 1.6 s at Most; Steadier Routing (2026-11-21)

From the user: the pipeline's view is a shell around the log, so changing how the process is shown never changes what is recorded; the view should read as a tree of decisions and what triggered them. Recomputing at most every 1.6 s. And, in their test, at "Alright" the message lit up and faded though nothing was said about it, and the printer's UI came before the printer was asked about and went once it was.
- **The decision record** (modos/decisions.mjs): each run of the pipeline logs one record (trace step `decisions`, kept whole): the run (revision, pause, how many sentences were asked about now); each sentence (its span in the words, whether it was asked about now, the themes it continues or began, mentions or stops, filler or not, to be told or done, yes/no); each theme of the question (its change: new, joined, mentioned, stopped; judged again; focus; `because`: the sentences); each MOD that scored, was shown or was chosen (came, stays, went, instead of another; the themes it serves); each fill (the themes it answers and its context, reused or asked again, selectors kept); each part (new, updated, kept, withdrawn; because: its fill); the text (the sentence it answers, writing, kept, dimmed, withdrawn). Each decision keeps all its options and how likely the model found each (a sentence: whether it says anything, `judged.adds`; which need, `judged.cont`; every MOD with its score; every fill's selectors with their options and what was taken, the taken one being what the fill took, a rule's choice included: a person the request names is a recipient). The pipeline's views read only it: the words row's marks and theme shading now, the pipeline view next (static mock: system/editor/pipeline.html, drawn from three real records, as the code runs it, every decision in the code's words: the sentence heard; the decisions asked together in one call (grounding; adds, cont_, ref_, ends_, know, yesno, about, mod_), on one level; the rules that place the sentence and pick the focus; the theme judged again (the second call); the rules that pick the MODs and decide the text, side by side; what each MOD fills in, framed, beside what the language model writes; and everything shown on the last level. Each decision shows all its options with their likelihood, the one taken lit; lines go from what was taken to the decisions it sets off). The record keeps for this: grounding's questions and answers, each sentence's yes/no, what it is about and the MODs it needs (with their likelihood), what a theme judged again is about, and the text's heading.
- **Recompute every 1.6 s at most**: the editor's store hands a draft's newest revision to the bridge no sooner than 1.6 s after its last run began (scripts/agent_store.py `RECOMPUTE_S`); words said meanwhile wait, and the newest text is answered when the time comes. Asking (Enter, Space let go) is not held.
- **Found with the record**: what a MOD serves flipped with pauses (themes at .35 or more counted while typing, .5 or more at a pause: the message counted the umbrella theme at .48 one moment and not the next, and was in focus, then not). A MOD now serves the themes that need it (.5), or, kept on while typing with none, those it is kept for; the same at a pause or not. And two ways to show one need (IoTControl, ObjectStatus) took turns on near-equal scores; the one shown stays unless the other is better by ALT_GAP (.15).
- **Routing**: a sentence that adds nothing ("Alright, um.") changes nothing, even when the model says it continues a theme (it had joined the weather theme and the text answered it); a clear question (know .85 or more) is never a filler ("What's the weather?" had been judged one, at .39, when it was the only sentence); a sentence that continues a theme does not stop it (a correction continues it: "Um, no." had stopped the weather theme and Weather went for 3.7 s). The filler question no longer asks whether a sentence "adds to what the user asks", which the only sentence cannot.
- **Within a theme, the latest decides**: the fill gets the theme's latest sentence as `said_last` (the umbrella today, after next week, in one weather theme).
- **The words row**: the words of one theme are shaded alike (the theme's colour, no label); a new line where the theme changes and after a MOD came. Marks, by what is seen: a MOD came (a part of it shown for the first time; a MOD chosen that draws nothing, a spec MOD, is not marked), a part taken away (new), a part already shown got new data, the text or a draft written again. A MOD came had been marked whenever the set of MODs chosen changed, spec MODs included, so it showed after many short sentences.
- **The writing ball**: larger, sized by the text's first line (about two thirds of its height).
- Open (found in the record, not changed): judged again on its words, the weather theme scored Send .70 to .80, so Send serves it: the message is in focus while the umbrella is asked about, and Send's fill answers the umbrella sentence, which names nobody, so the message loses its recipient (Alice).

### 12.32 Stage 1 Rebuilt: the Request's Type, Grounding, then the MODs, in Order (2026-11-24)

From the user, looking at every decision drawn (§12.31's mock): stage 1 asked many small questions at once, independent of each other, some the same thing twice or three times, and a rule then combined them (a filler's `cont_` was answered and then ignored). The relation of a sentence to an earlier one was two dimensions folded into one question (what it does, and with which theme), and what it does was never decided. Agreed: decisions in order, each call given what the one before decided (one Jev call each, about 0.15 to 0.35 s); the type several at once; the relation inside grounding.
- **Call 1, the request type** of each new or changed sentence (modos/request.mjs `typeQuestions`): information (to be told), action (to have something done), stop_prev (stop what was talked about), none (a filler, a remark, a repeat). Several may hold ("check the weather and send it to Alice"). None, said so (unless another type is clear, .85) or when no type holds: nothing after it runs for the sentence. Replaces `adds_`, `know` and the stop half of `ends_`.
- **Call 2, grounding** (modos/themes.mjs `groundCall`), three questions: 1, is it about an earlier request or something new (the themes before this call, and the sentences asked about in it before this one, "just said": "send a message to Alice. And mention our hiking plan" said at once goes on with the message; for a stop, which it stops); 2, how it goes on with the earlier one (asks more, adds a detail, corrects a detail) or what in the world the new one is about (the thing looked at, the area, a named place, the user's own, outside data), both asked and the one that applies kept; 3, which other earlier themes it also uses. For information only, beside it, yes/no: the answer's form. Replaces `cont_`, `ref_`, `about` per sentence, and the grounding questions `referent`, `followup` and `conversation_reference`, which asked one thing three times.
- **Rules**: where it goes (an earlier theme it joins; a sentence just said, where that one went; a new theme it begins; a theme it stops), the focus as before. A theme keeps what it is about (modos/grounding.mjs): the thing looked at when it began, and the items found for it (FindMy), so "is it free?" or "where is it?" going on with it refers to them; the clarifying question ("Which item do you mean?") went with the unresolved reference it answered. Whether "you" is the thing or the assistant is the facts' rule now (modos/compose.mjs `requestFacts`).
- **Call 3, the MODs** each theme whose words changed needs, judged once on all its words (modos/themes.mjs `modCall`): replaces the sentence's MOD scores and the theme's second judgement, which asked the same twice.
- **What each behaviour changes**: a correction alone makes its words decide (`said_last` to the fill); a detail added counts with the rest; a question asked more is a new question to be told in its theme. And what is said now is the themes the latest sentence went into; a theme it only uses is context (the umbrella today, a new theme that uses the weather: Weather reads the umbrella, today).
- **Tested on q90's words** (live replay, 2026-11-24): "What?" none; "Um, no, I mean next week." corrects the weather (Mon 11-30 to Sun 12-06); the hiking plan adds a detail to the message and uses the weather; the umbrella begins its own theme and uses the weather, Weather shows today, the text answers Yes; "Alright, um." none; the printer: IoTControl, ObjectStatus the same need. Send serves the message alone and keeps Alice throughout (it had lost her when the weather theme was judged to need Send).
- The decision record and the mock follow (each sentence's type, anchor, how, about, uses, yes/no, with their likelihood; a theme's referent, items, whether its MODs were judged). The mock reads as a flow from left to right on white, on a fixed grid (every frame the same width, every group named at one height, nothing moving from one sentence to the next): at the top, the utterance's sentences in a list that scrolls, the one in the middle picked (bold black; the further, the smaller and fainter), with the legend of the lines beside it; below, the run that last decided it. A line means "this set off that": from a port on the right of a frame when the whole decision leads on, from a port on an option when only that answer does ("information" sets off yes/no; an earlier theme sets off how it goes on, "new" what in the world); black where it was taken, grey where an option not taken would have led; a fact a later step uses runs along the bottom, dotted. The main path runs along the top (the sentence, its type, prev and ref, theme grounding, the MODs, the rules for what shows and the text, the fills, what shows); decisions used only for something else, with nothing after them (how it goes on: the fill; what in the world: context info; yes/no: the text's heading), sit on the bottom row, marked with what they are also used for. Theme grounding is one rule, from prev and ref: every theme listed, the one the sentence goes to bold black, those it uses bold grey. A rule shows only its outcome. Clicking a frame turns its lines and the frames they join pink.

### 12.33 Grounding in One Call or Two; the Context Anchor Moves an Earlier Theme (2026-11-24)

From the user, reading the mock: call 2 has a dependency inside it (the continuation is asked of a sentence that goes on with an earlier request), so is it one call or two; and a sentence said while pointing at a thing, which goes on with an earlier request, lost what it pointed at (its context anchor was asked, then set aside).
- **A switch** (modos/themes.mjs `GROUNDING.calls`, 1 by default; `runModos({groundingCalls})` for one run): in one call, everything at once, the continuation asked generally of every sentence ("if it goes on with an earlier request, how?") and set aside for a new one: one wait for the decision model per revision, more questions in it. In two calls, first what it is about (earlier or new, the context anchor, what else it uses, yes/no), then the continuation, only of the sentences that go on with an earlier request, each told which one: fewer and better posed questions, a second wait in a row (about 0.15 to 0.35 s) on every revision where a sentence goes on with one. The record says which (`run.grounding_calls`).
- **The context anchor is used either way** (modos/grounding.mjs `anchorThemes`): a theme begun now is about what its sentence anchors, as before; a sentence that goes on with an earlier theme while it anchors another thing looked at, or another named place, moves the theme there ("what's this?" about the candy, then "and this one?" pointing at the window: the window); anchored to the user or outside data, the theme keeps its own. The record marks a theme moved (`moved`).
- The context anchor (asked "What in the world is {sentence} about?"; the pipeline page names it "What in the world does it refer to?") informs each fill and the text response in both cases.
- Tested: tests for both (the theme moved to the window; no second call when nothing goes on with an earlier request); q90's words typed again with one call behave as before.

### 12.34 The Pipeline Page; the Editor's Pipeline as Results; Questions Named by Day (2026-11-24)

From the user: the mock becomes a page of its own, live; the editor's pipeline shows only results, as before, with a button to it; questions get names people can track.
- **The pipeline page** (system/editor/pipeline.html, served by the editor): every decision of a question as a flow, read only from its runs' decision records (GET /api/agent/questions/runs) and where the user was and looked (`view_context`). At its top, a chooser of the scene's questions (newest first, by name) beside the question's sentences (scrolled freely; a click picks one, the run that last decided it is shown). The chooser lists only questions whose decision record is in the current form (and one just begun, or the one followed live); a question run before records were kept, or with the older names, is left out. Live (`live=1`, or its check box): it follows the conversation's newest question, its runs as they come (once a second). The flow is the page's bottom section, filling the window under the top; a canvas (pan, zoom between fit all and 2×; fit height, the default, and fit all). The sentence heard is a column half as wide as the others. Decisions list all their options, the one taken black; rules give their outcome (Theme grounding lists the themes; MODs shown lists the MODs with why one is not shown, its two rules beneath; Text response is a table of the newest question by the moment of the run); each MOD's fill is a grey panel with a fixed height, scrolled inside. Lines: data from a frame or from one answer (black; grey where an answer not taken would lead), context informing a later step (dotted, from the sentence at the foot of its frame). Call 2: earlier_or_new, context_anchor and also_uses are set off by call 1's answers; earlier_or_new's earlier answers lead to continuation and to also_uses (the theme a sentence goes on with is not one it also uses); answer_form only from information (true or false). A click on a frame turns pink its lines that were taken and the frames they join.
- **The editor's pipeline** (src/pipeline-view.mjs): the results only, down a line as before: Request type, Theme grounding, MODs shown, Text response, Fill · write, Shown, from the latest decision record so far; a button at its head opens the pipeline page on the question, live. The MOD skeleton it used to list every option is gone (`/api/modos/context` stays for the bridge).
- **Decisions named in the code as on the page**: each Jev question's id is its decision's name and the sentence it is asked of: call 1 `request_type_{information,action,stop_prev,none}_s<i>`; call 2 `earlier_or_new_s<i>`, `continuation_s<i>`, `context_anchor_s<i>`, `also_uses_s<i>_t<id>`, `answer_form_s<i>`; call 3 `mod_need_<mod>__t<id>`. The calls are the stages `modos_request_type`, `modos_grounding` (and `modos_continuation` with two grounding calls), `modos_mod_need`. The decision record uses the same names: a sentence's `request_type`, `continuation`, `also_uses`, and `judged` {request_type, earlier_or_new, continuation, context_anchor, also_uses, answer_form}.
- **The editor's pipeline without explanations or repeats** (from the user): stage titles alone (no what, why or how beneath them); Request type gives each sentence's type without the sentence (it is said or typed right there); Text response its outcome without the sentence it answers; Shown the text's state (written, kept, dimmed, …), not the outcome again. Its button opens the pipeline page in a tab of its own, also from the Demo.
- **Questions named by day**: q-MMDD-N, the question's number among those made that day in the scene (scripts/agent_store.py `_label`), never given again (the day's last number is kept apart, `.question-labels`); questions made before get theirs once, in the order they were made. The pipeline page and the editor's pipeline show the name.

### 12.35 The Prompts' Words in One File, Edited on the Pipeline Page (2026-11-24)

From the user: a decision double-clicked on the pipeline page opens a peek over it, to see its prompt and edit the words that can be edited.
- **modos/prompts.json** holds the words of every stage 1 prompt and of call 3, by decision (request_type, earlier_or_new, continuation, context_anchor, also_uses, answer_form, mod_need), and how a sentence is named in them (`sentence`: the whole question, a sentence of it, the one said before it, still being said), shared by all. What is filled in at run time is a placeholder ({sentence}, {theme}, {earlier}, {name}, {mod}, …). modos/request.mjs and modos/themes.mjs read it; modos/prompts.mjs fills it in (pure, for the pipeline and the page alike). Moved without a word changed: the prompts asked are the same as before. The options that come from the space or the conversation (the earlier themes, the places, the MODs) are not words of a prompt; a MOD's name, description and examples are the MOD's, tailored in the MODs tab. The fills' prompts (modos/selectors.mjs) are not in it yet.
- **The peek** (system/editor/pipeline.html): over the flow, under the decision double-clicked (above it when there is no room), inside the window: the prompt as asked for the sentence picked (the field in focus, filled in as the pipeline fills it, the other placeholders as tokens; it stays at the top as the words scroll), then each of its words in a field, and how a sentence is named, folded. Each field lists its placeholders; one lost or added is marked and Save waits. Esc, Cancel or a press outside close it (not with words unsaved).
- **Saved** through POST /api/modos/prompts (scripts/modos_prompts.py): the same prompts, words only, each with the same placeholders; anything else is refused and nothing is written. The bridge counts the file as its code: it renews itself with the new words before the next question.
- The tests' scripted engine answers the request type by the question's id, not its words, so an edit does not change what the tests decide.

### 12.7 Not Done Yet

- Measure on the Gallery's clips: time from the first keystroke to the first correct part, against Enter; corrections per question; decision calls per question.
- Cues still rebuild when their part is replaced (a part's facts, such as what its question is about, change as it is typed); in-place updates come with §11 step 3.
- Speech: the same path takes an ASR's partial results (words with times) in place of keystrokes.
- Next: the pipeline view, drawn only from the decision record, as its mock (system/editor/pipeline.html). Stage 1 was rebuilt first (§12.32).
- Next (noted 2026-11-19, not started): speech to text's punctuation cuts a spoken request into fragments ("This weekend.", "During.", "Um.") that become questions of their own. Look at what Doubao's recognition can be set to (its sentence ending, punctuation and the two passes' parameters) to cut where the speaker's request ends rather than where they paused.
- Themes: how a background theme steps aside in view (the parts carry the fact; no visual yet); the first version keeps them as they are. A sentence of one request cut into pieces by speech to text ("I mean, Alice and Rebecca.") may still begin a theme of its own (§12.21).
- Minor (from the user, 2026-11-24):
  - **The main page first** (done 2026-11-24): once the system is started, the page that opens is the main page (`index.html`: Demo, Gallery, Vocabulary, About), not the editor on its own. The server serves the repository as the site: the main page at `/`, the editor at `/system/editor/` (only framed, by the Demo and a Gallery example; opened on its own it goes to the main page with its query, except the example view's tool modes `ask=1` and `still=1`), the pipeline page at `/system/editor/pipeline.html`, the Gallery's examples at `/context/gallery/`; nothing else of the repository. A session is a path relative to the editor (`./spaces/…`) or a URL's pathname on the site (`/system/editor/spaces/…`); stored data is unchanged.
  - **Session names** (done 2026-11-24: a session is named for its first question's first words and its time, "What's the weather… · 11-24 17:12", unless the user renamed it; ★ examples tagged in place; `npm run gallery`, Rerun and `live-replay --from` replace their question in place once answered and set the session's time to now; the existing 24 Gallery copies were merged into their originals, 1 kept as its own, 3 live replays with an original deleted, 4 kept): the agent's sessions were named confusingly. A session saved to the Gallery is not copied: the session itself gets a star at its end. A live replay updates the original session's name and time instead of saving a separate "live replay" copy.
  - **The repo holds only what is needed**: ideally the system and the pipeline page; anything else is looked at and removed or moved out.
  - **About**: the pipeline page is the main content of About's Walkthrough; Memory and Decisions are removed; a new tab, ModOS, is added.
