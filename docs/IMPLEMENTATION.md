# 实现说明

面向维护者。用户文档见 [README](../README.md)。

## 总体结构

| 文件 | 职责 |
|---|---|
| `lib/index.js` | 宿主半侧：创建零落盘会话、把 agent 收养进主 registry、暴露 `open` / `close` 两个 HTTP 方法 |
| `lib/client.js` | 浏览器半侧：注册页签类型与席位，调宿主接口拿到会话，再用宿主原生界面渲染 |
| `cordis.patch.yml` | bundle 补丁，插入一行 loader 记录 |

客户端半侧是手写 bundle（无构建步骤），只 `require('react')`——它是平台种子模块，所以不需要 `dsh.client.external` 声明。

## 为什么需要宿主半侧

原生的 `sessions.create` / `sessions.fork` 都会经过 agent 生命周期，而生命周期会为已发布的会话附上**会话日志写句柄**，于是会话落盘、进入左侧列表。这正好与「临时对话」相反。

所以宿主半侧要做的是：在**拿不到写句柄**的前提下把会话造出来，同时让它仍能被原生输入框驱动。

### 零落盘

`sessions`（`dsh-session` 的 `SessionStore`）本身就是纯内存的，源码注释写得很直白：

> Persistence is intentionally not implemented here — the agent lifecycle attaches a session-log writer to each published session's write handle; a session published outside that lifecycle persists nothing.

于是做法是：在一个 `sessionPersistence` 解析不到的隔离作用域里，再挂一套 agent 栈。

```js
const scope = ctx
  .isolate('sessionPersistence')   // 唯一的「不提供」——缺失即不落盘
  .isolate('agents')
  .isolate('agentLoop')
  .isolate('systemPrompt')
```

### 三个必须重新挂载的名字

`agents`、`agentLoop`、`systemPrompt` 也隔离了，但**必须**在同一作用域内重新挂载，否则 `AgentLoop` 的 `static inject` 里有永远解析不到的名字，它的 fiber 会一直停在 PENDING：

- fiber 不到 ACTIVE → `agents.setFactory()` 不执行；
- 于是 `create()` 报 `no agent factory registered`。

这不是可选项。`sessionPersistence` 是唯一「故意不提供」的那个，因为它的缺席正是目的。

### 收养进主 registry

隔离栈里造出来的 agent 不在主 registry，原生输入框的 prompt / cancel 路径找不到它。所以创建后立刻收养：

```js
const release = await Promise.resolve(mainAgents.register(handle.agent))
```

`AgentRegistry.register(agent)` 的契约是「把已构造好的 agent 记录进 store」，因此这一步只增加可达性，不增加持久化。

### 工具集：必须挂载 agent 预设

一个会话真正能用哪些工具，**不取决于工具插件是否加载，而取决于它的 agent 预设**。会话控制器里的 `composeAgent` 是这么做的：

```js
async composeAgent(presetId) {
  const presets = this.ctx.get('agentPresets')
  if (presets === void 0) return { setup: (_agentCtx, agent) => { this.installSelection(agent) } }
  const resolvedId = (await presets.resolve(presetId)).id
  return {
    agentPreset: resolvedId,
    setup: async (agentCtx, agent) => {
      this.installSelection(agent)
      await presets.mount(agentCtx, resolvedId)   // ← 预设的插件行被挂进 agent 作用域
    },
  }
}
```

`presets.mount(agentCtx, id)` 会把预设声明的插件行（`dsh-tool-fs`、`dsh-tool-pwsh`、`dsh-tool-fs-search` 等）加载进**该 agent 自己的作用域**，工具随之出现。

只手写 prompt section、不挂预设的话，侧聊只能看到全局层里那几个基础工具。实测就是这个现象：只有 `working_directory` 和 `load_workspace_dependencies`，读文件、跑命令全无。所以 `setup` 里必须先挂预设：

```js
const presets = ctx.get('agentPresets')
if (presets !== undefined) {
  const resolved = await presets.resolve(undefined)   // 不传 = 配置里的默认预设
  await presets.mount(agentCtx, resolved.id)
}
```

`setup` 可以是 async——`AgentLoop` 里是 `await setup?.(...)`，所以能直接 `await` 挂载。

**实测结果**（挂载后，同一句「列出你可用的工具名」）：

```
ask_user_question, create_goal, edit, exit_plan_mode, get_goal, glob, grep,
interrupt_agent, job_kill, job_list, job_output, list_agents, present, pwsh,
read, read_image, schedule_create, ..., todo_write, update_goal, web_fetch,
web_search, workflow, working_directory, write
```

共 30 个，含 `read`/`edit`/`glob`/`grep`/`pwsh`/`write`。再让它读一个真实文件，返回了该文件的 `name` 字段值，确认工具是**能真正执行**的，不只是 schema 可见。

### schema 转发

挂载预设之后，`SystemPrompt` 一侧还要把共享 `tools` 服务的 wire schema 转发进隔离实例（新建的 `SystemPrompt` 是空注册表）：

```js
isolatedPrompt.tools((context) => sharedTools.wireSchemas(context.scope))
```

注意 `tools` 服务**没有**被隔离，执行与 schema 都走同一个注册表。

### 上下文

主对话快照（`deriveMessages()` 的纯投影，按字符预算裁剪尾部）写进 agent 的 **prompt section**，不写进转写：

- 模型有上下文；
- 面板打开是空的；
- 不回写主对话。

`setup(agentCtx)` 里不能直接读 `agentCtx.systemPrompt`（会抛 `cannot get property "systemPrompt" without inject`），要走动态注入：

```js
agentCtx.inject(['systemPrompt'], (injected) => { ... })
```

## 客户端

### 注册

```js
ctx.sidebarRightTabs.register({
  id: 'dsh-side-chat', kind: 'sidechat', priority: 'extension',
  multiple: true,          // 否则同一 kind 复用同一地址，一个主对话只能有一个侧聊
  title, guide,
})
```

body 槽要声明子槽，才能在 body 内部渲染会话：

```js
children: { 'dsh-side-chat.conversation': { kind: 'single', scope: 'session' } }
```

### 渲染

原生侧边栏框架会把 `SessionProvider`、`renderSlot`、`renderFactorySlot` 注入给 body：

```js
h(SessionProvider, { session: reference }, renderSlot('dsh-side-chat.conversation', {}))
```

自己的 seat 再交回宿主：

```js
props.renderFactorySlot(
  'conversation.content',
  { variant: 'embedded', phase: 'active', hero: false },
  { slots: { views: ChatView } },
)
```

`ChatView` 是 `props.renderSlot('conversation.session', { view: 'chat' })` 的包裹层——它是滚动锚点，必须存在。

> 注意：`slots: { views: ... }` 是**全局注册**，主对话也会渲染这个组件。给 `ChatView` 加包裹层会影响主对话（例如把它的「用时」行带到列表底部）。当前实现接受这一代价以换取侧聊可滚动。

### 生命周期

会话按 `parentSessionId + tabId` 缓存在模块级 `Map` 里：

| 事件 | 行为 |
|---|---|
| 切换主对话 / 布局重排（组件卸载） | **保留**，回来仍是同一个侧聊 |
| 关闭页签（tab `signal` abort） | 释放引用 + 调宿主 `close`，会话回收 |
| 插件重载 | `disposeAllChats` 兜底 |

`tabId` 尚未就绪时不要开始创建——否则 key 变化会多造一个会话。

### 布局

宿主把转写区和输入框塞进同一个 `[data-conversation-scroll]`，并且输入框是 `position: sticky`；而宿主的 `flex-shrink: 0` 会覆盖插件的 `flex` 收缩设定，导致转写区按内容高度撑开、永不滚动。

因此改用 grid——行高不参与那套协商：

```css
.dsh-side-chat-host{position:absolute;inset:0;display:flex;flex-direction:column;min-height:0;overflow:hidden}
.dsh-side-chat-host>*{flex:1 1 0%;min-height:0;display:flex;flex-direction:column;position:relative}

.dsh-side-chat-host [data-conversation-scroll]{
  display:grid!important;
  grid-template-rows:minmax(0,1fr) auto;
  min-height:0;
  overflow:hidden;
}
.dsh-side-chat-host [data-conversation-scroll] > *{min-height:0}

.dsh-side-chat-view{display:flex;flex-direction:column;min-height:0!important;overflow-y:auto!important}

.dsh-side-chat-host [data-conversation-region="composer"]{position:static!important;flex:0 0 auto;z-index:auto}

/* 统计行空态会折叠，导致输入框先贴底、首轮出用量后被顶高 */
.dsh-side-chat-host [data-composer-dock]{min-height:22px}
```

要点：

- `minmax(0, 1fr)` 让第 1 行有确定上界，转写区才会滚；
- 输入框从 `sticky` 改回 `static`，它成为第 2 行，不再覆盖正文；
- `[data-composer-dock]` 的 `min-height` 让统计行在空态与有内容时占同一高度，输入框因此不跳；
- `!important` 是必要的——宿主规则优先级更高；所有规则都限定在 `.dsh-side-chat-host` 下，不影响主对话。

### 「已完成，用时 X」为什么在回答下方

`turn-tail` 是宿主 `conversation.chat.node` 的一个 node kind，`match` 绑定 `turn/end`，源码注释写明 *the tail stays the turn's last node*。也就是说它在**每一轮的末尾**，主对话与侧聊一致，不是布局缺陷，无需修正。

## 选中内容唤起侧聊

在主对话里选中一段回答 → 浮出「在侧边聊天中提问」→ 打开（或复用）这条主对话的侧聊，选中内容变成输入框上方的一张**引用卡**：看得见、可移除，同时进入这条侧聊的上下文。

### 选区捕获

`document` 上三个监听：`selectionchange`（防抖 200ms）、`mouseup`、`keyup`。校验规则：

- 两端点必须落在**同一个** `[data-chat-flow-kind="assistant-step"]` 节点内 —— 跨消息划选不弹工具条；
- 带 `data-streaming` 的消息排除（还在流式输出，引用会截到半句）；
- 带 `[data-dsh-side-chat]` 的自己 DOM 排除（否则点工具条那一刻会被判成选区变化而自杀）。

工具条是纯 DOM（`position:fixed` 挂在 `body`），不为一个按钮起 React 根；文案在**每次显示时**解析，而不是挂载时——见「文案时序」。

### 为什么不写进输入框

输入框是 contenteditable，只认两样东西：纯文本，和 `@` 文件引用 chip。引用塞进去只能是两种下场——一串 `> ` markdown 字符（它并不会被渲染成引用块，还占掉打问题的位置），或者去改宿主的草稿文档结构。所以引用**不进输入框**：内容走上下文，形态走界面。

### 引用卡渲染在哪

宿主的 `conversation.input.dock` 就是「composer 卡片上方的整行插槽」，`scope: session`，官方 occupants（voice-input 的录音态、todo dock）都注册在这里。插件把卡片组件塞进去，用 `props.sessionId` 判断这是不是自己开的会话——不是就 `return null`，所以主对话不会被插一张卡。

卡片数据是一个模块级 immutable map（`cardsBySession`）配 `useSyncExternalStore`，**订阅函数身份必须稳定**。早期实现给每个会话建一个「第一条引用到达时才存在」的小 store，于是 dock 挂载时订阅的是「没有 store」这件事，卡片后来出现也不会触发重渲染：静默失败，什么都看不见。

### 卡片长什么样

一条侧聊只有**一张**聚合卡：

- 计数条：whale glyph + `N 个已选文本片段`（英文 `{count} selected fragments`），由 `quoteCountOne` / `quoteCountMany` 两个 key 提供 `{count}` 模板，插件自己 `.replace`——不走宿主插值；
- 正文：一片段一行，`line-clamp: 3` 截断出省略号。侧聊面板宽度有限，长引用必须截，否则 composer 会被顶出可视区；
- 悬停：`onMouseEnter` 记下卡片视口矩形，浮出 `position: fixed` 的完整文本面板。定 position 而不是 absolute，是因为 dock 的祖先带 overflow 裁剪，绝对定位的面板会在卡片边界被切掉；面板自动选择上/下方位避免出屏，滚动或 resize 时立即收起（否则它会悬在无关内容上方）；
- 移除：每段一个 ×（平时 0 透明，行 hover 才出现），点一下同时从卡片与宿主上下文删掉。

失败片段保留在卡片里并显示原因，不静默丢弃——引用没进去和「这个功能根本没接上」在用户眼里是同一件事。

### 卡片只是显示，内容走宿主

点一次引用 = `POST /side-chat/api/quote/add`，宿主把它存进该侧聊的 `quotes` 数组。该侧聊的 prompt section 以**函数形式**注册：

```js
provider.systemPrompt.section({
  name: 'side-chat-quotes',
  interpolate: false,
  order: 910,
  text: () => quotesFor(quotes),
})
```

组装每一步的 system prompt 时都会重读这个数组，所以点 `×` 删掉卡片，下一步模型就看不到这段引用了。`interpolate: false` 是必须的：引用内容里出现 `{{name}}` 会在组装阶段被判成 prompt 变量并抛错，把整条侧聊打挂。主快照 section 同样带 `interpolate: false`——主对话里出现 `{{` 是常态（模板、日志、代码）。

### 引用卡交互

先入队列再开面板（15 秒 TTL），窗口期靠 `wakeQuotes` 叫醒已开的面板。一个主对话一条侧聊（tab 类型不声明 `multiple`，地址稳定走 reveal）。文案注册早于任何取文案的效果，工具条每次显示时重新解析避免中英文不一致。

Popover hover：`position: fixed` 防止 overflow:hidden 裁剪；自动上/下方位、滚动收卷、resize 收卷。失败标原因不丢弃，用户眼里「看不见的引用」=「功能没接上」。

### 依赖的是宿主内部标记

`data-chat-flow-kind`、`data-streaming`、`data-sidebar-right-session`、`conversation.input.dock` 的 props 形状都是宿主**内部实现**，不是公开契约。上游重构会让这个功能静默降级（不弹工具条、不出现卡片），不会崩——所以整条链路都在 try/catch 里。另外宿主半（`lib/index.js`）改了必须重启应用，只刷新页面不会让新路由生效。

## 已知限制

- **依赖 `sessions.retain`**：宿主不暴露会话所有权时，面板显示本地化失败提示加底层原因，而不是空白。
- **一页签一会话**：关闭即回收，不恢复。
- **快照不跟随**：侧聊看不到打开之后主对话的新内容；引用是例外，它按卡片增删实时生效。
- **引用不落盘**：和侧聊会话本身一样，重启应用即消失。
- **布局依赖 `!important`**：见上。
- **主对话受影响**：`views` 覆盖是全局的，`ChatView` 的包裹层会一并作用到主对话。

## 实测数据

以下来自本机真实宿主：

| 检查项 | 结果 |
|---|---|
| `POST /side-chat/api/open` | 200，约 100 ms，返回会话 id |
| `POST /side-chat/api/close` | 200 |
| 开关一次侧聊后的 `$DSH_HOME/sessions` 文件数 | **101 → 101，未变** |
| 隔离栈挂载、loop 注册 factory | 通过 |
| 客户端包被发现并下发 | 通过 |
| 同一主对话重复唤起侧聊 | 复用同一 tab（tab 类型不声明 `multiple`） |
| 引用流程仿真（mini-React 执行真实 bundle） | 18 项全通过：工具条出现且为中文、点击开 tab、引用**不**进输入框、`quote/add` 落到宿主、聚合卡渲染计数条与原文、移除后卡片消失并通知宿主 |
| 聚合卡布局 | 一卡一计数条 + N 片段行，每片段 `line-clamp: 3` 省略号截断，hover 浮出 fixed popover 显示完整文本，自动上下选择，滚动/resize 立即收卷 |
| 宿主半未重启时 | `POST /side-chat/api/quote/add` → `404 not-found`，卡片保留并标为「失败 + 原因」 |

无头环境无法验证：内嵌面板是否真的绘制、`conversation.input.dock` 在桌面壳里的实际位置、该宿主是否提供 `sessions.retain`。后两者缺失时分别表现为「卡片不出现（但引用仍进上下文）」与「面板明确报错」。

## 图标

`assets/icon.png` 由 `lib/client.js` 里内嵌的同一份 alpha 遮罩生成（颜色 `#586BFD`），保证文档与运行界面不会出现图标不一致。重新生成时从 bundle 里取出 `GLYPH_MASK` 的 base64、按 `GLYPH_COLOR` 上色即可。
