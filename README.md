<p align="center">
  <img src="assets/icon@2x.png" width="96" alt="dsh-side-chat 图标">
</p>

<h1 align="center">dsh-side-chat</h1>

<p align="center">
  右侧边栏里的侧边聊天，直接复用 DeepSeek Harness 自己的会话界面渲染。
</p>

---

它不是仿制的面板，而是宿主**真正的**转写区与**真正的**输入框，绑定在一个独立会话上：

- Markdown 渲染、工具调用步骤、逐轮用时、Token 用量——与主对话同一个渲染器；
- 原生输入框：`+` 附件、权限选择、模型选择、`@` 文件引用、斜杠指令；
- 会话**只存在于内存**：不写会话日志，`$DSH_HOME/sessions` 不新增文件，左侧会话列表也不会被塞满；
- 主对话的快照作为**只读参考上下文**注入，模型知道刚才在讨论什么，而面板打开时是空的。

## 安装

在 profile 目录下执行：

```powershell
pnpm add file:./plugins/dsh-side-chat
```

并把 `"dsh-side-chat"` 加入 `dsh.profile.bundles`，然后重启应用。

## 使用

打开右侧边栏的引导页，选择 **侧边聊天**，或按 `Ctrl+Alt+S`（macOS 为 `Command+Alt+S`）。
每次打开都会新建自己的页签，所以一个主对话可以同时开多个侧聊。

## 实现方式

全部能力来自宿主的三个接口，聊天界面本身没有一行是自己画的。

| 能力 | 用途 |
|---|---|
| 隔离 `sessionPersistence` 作用域 + `mainAgents.register(agent)` | 让 agent 创建时**拿不到会话日志写句柄**（零落盘），再注册进主 registry，使原生输入框可以驱动它 |
| `sessions.retain(id, { source })` | 为该内存会话持有 `SessionReference` |
| `SessionProvider` + `renderFactorySlot('conversation.content', …)` | 用这个引用渲染宿主的会话 |

页签 body 由原生侧边栏框架注入 `SessionProvider`、`renderSlot`、`renderFactorySlot`，所以只需要把它们组合起来：

```js
h(SessionProvider, { session: reference }, renderSlot('dsh-side-chat.conversation', {}))
```

而它自己声明的 seat 原样交回宿主：

```js
props.renderFactorySlot(
  'conversation.content',
  { variant: 'embedded', phase: 'active', hero: false },
  { slots: { views: ChatView } },
)
```

类型注册只有这一份：

```js
{ id: 'dsh-side-chat', kind: 'sidechat', priority: 'extension', multiple: true, title, guide }
```

外加一个 body 槽，声明子槽
`children: { 'dsh-side-chat.conversation': { kind: 'single', scope: 'session' } }`。

### 零落盘：没有 `ephemeral` 开关时怎么做

Codex 有 `thread/fork { ephemeral: true }`，会同时短路 JSONL rollout 与状态数据库。
DSH 0.2.1-rc.3 没有这个开关，等价物只能用宿主已暴露的机制拼出来：

- `sessions` 本身就是纯内存 store——落盘只发生在 agent 生命周期为已发布会话附上写句柄的那一刻；
- 在一个 `sessionPersistence` 解析不到的作用域里再挂一套 `dsh-agent` + `dsh-agent-loop`，loop 就**不会**拿写句柄；
- loop 注入的其它名字（`agents`、`agentLoop`、`systemPrompt`）必须在同一作用域内重新挂载，否则它的 fiber 会一直等一个没人提供的依赖，永远停在 PENDING，`agents.setFactory()` 也就不会执行；
- 创建出的 agent 再注册进**主** registry，于是原生 prompt / cancel 路径可以驱动它，而它依然不持久化。

主对话快照走 agent 的 **prompt section**，绝不进转写：模型拿到上下文，面板保持空白，也不会回写主对话。

### 布局

宿主把转写区和输入框塞进同一个 scroll body，并用 flex 收缩输入框，而这个收缩被宿主自己的规则覆盖了——所以在这条链上 flex 不是可靠的杠杆。改为把 scroll body 换成 grid，行高不参与那套协商：

```css
.dsh-side-chat-host [data-conversation-scroll]{
  display: grid !important;
  grid-template-rows: minmax(0, 1fr) auto;
  min-height: 0;
  overflow: hidden;
}
.dsh-side-chat-host [data-conversation-region="composer"]{ position: static !important; }
```

第 1 行被 `minmax(0, 1fr)` 约束，转写区因此可滚；第 2 行是输入框的自然高度，因此贴底且不覆盖正文。

## 已知取舍

- **依赖 `sessions.retain`。** 宿主若不暴露会话所有权，面板会显示一条本地化失败提示加底层原因，而不是空白。
- **一页签一会话。** 关闭页签即回收内存会话，不会恢复。
- **快照就是快照。** 侧聊打开后主对话新增的内容它看不到——与 Codex 语义一致。
- **共用工作区。** 侧聊看到同样的文件与工具，这是它的价值，也是它的风险。
- **布局用到了 `!important`。** 宿主的规则优先级高于插件，上面两条结构性规则必须带它；它们都限定在 `.dsh-side-chat-host` 下，不会影响主对话。

## 已验证

以下数据来自本机真实宿主，不是推断：

| 检查项 | 结果 |
|---|---|
| `POST /side-chat/api/open` | 200，约 100 ms，返回会话 id |
| `POST /side-chat/api/close` | 200 |
| 开关一次侧聊后的 `$DSH_HOME/sessions` 文件数 | **101 → 101，未变** |
| 隔离栈挂载、loop 成功注册 factory | 通过 |
| 客户端包被发现并下发 | 通过 |
| 一个主对话可开多个侧聊 | 类型已设 `multiple: true` |

无头环境无法验证的两点（需要应用窗口）：内嵌面板是否真的绘制出来，以及该宿主是否提供 `sessions.retain`。后者缺失时面板会明确报错。

## 图标

`assets/icon.png` 由插件内嵌的同一份 alpha 遮罩生成（所以文档与运行界面不会出现图标不一致），颜色取原图的 `#586BFD`。

## 卸载

删除 `plugins/dsh-side-chat/`，从 `package.json` 移除依赖与 bundle 行，执行 `pnpm install`，重启。

## 参考项目

本插件的实现思路参考了开源项目 [dsh-sidenote](https://github.com/g-yixuan/dsh-sidenote)。
