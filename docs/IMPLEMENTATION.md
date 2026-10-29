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

## 已知限制

- **依赖 `sessions.retain`**：宿主不暴露会话所有权时，面板显示本地化失败提示加底层原因，而不是空白。
- **一页签一会话**：关闭即回收，不恢复。
- **快照不跟随**：侧聊看不到打开之后主对话的新内容。
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
| 一个主对话开多个侧聊 | `multiple: true` |

无头环境无法验证：内嵌面板是否真的绘制、该宿主是否提供 `sessions.retain`。后者缺失时面板会明确报错。

## 图标

`assets/icon.png` 由 `lib/client.js` 里内嵌的同一份 alpha 遮罩生成（颜色 `#586BFD`），保证文档与运行界面不会出现图标不一致。重新生成时从 bundle 里取出 `GLYPH_MASK` 的 base64、按 `GLYPH_COLOR` 上色即可。
