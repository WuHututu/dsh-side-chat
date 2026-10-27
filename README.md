<p align="center">
  <img src="assets/icon@2x.png" width="96" alt="dsh-side-chat 图标">
</p>

<h1 align="center">dsh-side-chat</h1>

<p align="center">
  右侧边栏里的侧边聊天，用 DeepSeek Harness 自己的会话界面渲染。
</p>

---

## 它是什么

在右侧边栏开一个临时对话，用来处理主线之外的支线问题：问一句、查个东西、试个想法，不打断正在跑的主任务。

它长得和主对话**一模一样**——因为它用的就是主对话那套界面：Markdown 渲染、工具调用步骤、逐轮用时、Token 用量、`+` 附件、权限选择、模型选择、`@` 文件引用、斜杠指令，全都在。

## 和主对话的关系

- **有上下文**：打开时会带上主对话当前的快照，所以它知道刚才在讨论什么；
- **单向隔离**：主对话之后新增的内容它看不到，它说的话也不会写回主对话；
- **不落盘**：会话只存在内存里，关闭即消失，`$DSH_HOME/sessions` 不会多出文件，左侧会话列表也不会被临时提问塞满。

## 安装

在 profile 目录下执行：

```powershell
pnpm add file:./plugins/dsh-side-chat
```

把 `"dsh-side-chat"` 加入 `dsh.profile.bundles`，重启应用。

## 使用

打开右侧边栏的引导页，点 **侧边聊天**；或直接按 `Ctrl+Alt+S`（macOS 为 `Command+Alt+S`）。

- 一个主对话可以同时开**多个**侧聊，各自独立；
- 切换主对话不会丢失已开的侧聊，切回来还在；
- 关闭页签或退出应用即消失，不占任何空间。

## 常见问题

**打开后是空的，正常吗？**
正常。它继承了主对话的上下文，但不会把主对话的历史铺在面板里。

**为什么它看不到主对话后来的新消息？**
侧聊拿的是打开那一刻的快照，这是刻意的——支线讨论不该被主线的新内容带跑。

**关掉后还能找回吗？**
不能。这是临时对话，关掉即回收。

## 更多

实现机制、布局约束、已知限制与实测数据，见 [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md)。

## 参考项目

本插件的实现思路参考了开源项目 [dsh-sidenote](https://github.com/g-yixuan/dsh-sidenote)。
