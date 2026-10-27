<p align="center">
  <img src="assets/icon@2x.png" width="96" alt="dsh-side-chat icon">
</p>

<h1 align="center">dsh-side-chat</h1>

<p align="center">
  A side conversation in the right Sidebar, rendered by DeepSeek Harness's own conversation UI.
</p>

---

What you get is not a look-alike panel: it is the host's **real** transcript and
the host's **real** composer, bound to a session of its own.

- markdown answers, tool steps, per-turn timing, token usage — the same renderer
  the main thread uses;
- the real composer: `+` attachments, permission selector, model selector,
  `@` file references, slash commands;
- a session that is **memory-only**: it never writes a session log, so
  `$DSH_HOME/sessions` gains nothing and the conversation list stays clean;
- the parent conversation's snapshot as **reference context only**, so the model
  knows what was being discussed while the panel itself opens empty.

## Install

From the profile directory:

```powershell
pnpm add file:./plugins/dsh-side-chat
```

and add `"dsh-side-chat"` to `dsh.profile.bundles`. Restart the app.

## Use

Open the right Sidebar's guide page and pick **侧边聊天**, or press `Ctrl+Alt+S`
(`Ctrl` is `Command` on macOS). Each open mints its own tab, so one conversation
can hold several side chats at once.

## How it works

Three host capabilities do the work; nothing about the chat surface is
re-implemented.

| Capability | Used for |
|---|---|
| isolated `sessionPersistence` scope + `mainAgents.register(agent)` | create the agent with **no session-log write handle** (nothing on disk), then adopt it into the main registry so the product's composer can drive it |
| `sessions.retain(id, { source })` | hold a `SessionReference` for the memory-only session |
| `SessionProvider` + `renderFactorySlot('conversation.content', …)` | render the host's conversation for that reference |

The tab body is handed `SessionProvider`, `renderSlot` and `renderFactorySlot` by
the native Sidebar framework, so it only has to compose them:

```js
h(SessionProvider, { session: reference }, renderSlot('dsh-side-chat.conversation', {}))
```

and the seat it declares for itself delegates straight back into the host:

```js
props.renderFactorySlot(
  'conversation.content',
  { variant: 'embedded', phase: 'active', hero: false },
  { slots: { views: ChatView } },
)
```

The type registration is only:

```js
{ id: 'dsh-side-chat', kind: 'sidechat', priority: 'extension', multiple: true, title, guide }
```

plus a body slot with
`children: { 'dsh-side-chat.conversation': { kind: 'single', scope: 'session' } }`.

### Ephemeral, the hard way

Codex has `thread/fork { ephemeral: true }`, which short-circuits both the JSONL
rollout and the state database. DSH 0.2.1-rc.3 has no such flag, so the
equivalent is assembled from what the host does expose:

- `sessions` is a plain in-memory store — persistence only happens when the agent
  lifecycle attaches a session-log writer to a published session's write handle;
- mounting a second `dsh-agent` + `dsh-agent-loop` pair inside a scope where
  `sessionPersistence` does not resolve means the loop takes **no** write handle;
- every other isolated name the loop injects (`agents`, `agentLoop`,
  `systemPrompt`) must be re-provided inside that scope, or its fiber waits
  forever for a dependency and never registers a factory;
- the resulting agent is then registered into the **main** registry, which makes
  it reachable by the normal prompt/cancel path without making it persistent.

The parent snapshot rides the agent's **prompt section**, never its transcript:
the model gets the context, the panel stays empty, and nothing is written back.

### Layout

The host packs the transcript and the composer into one scroll body and shrinks
the composer with flex, which the host overrides; flex shrink is therefore not a
reliable lever here. The scroll body is switched to a grid instead, whose row
sizing does not take part in that negotiation:

```css
.dsh-side-chat-host [data-conversation-scroll]{
  display: grid !important;
  grid-template-rows: minmax(0, 1fr) auto;
  min-height: 0;
  overflow: hidden;
}
.dsh-side-chat-host [data-conversation-region="composer"]{ position: static !important; }
```

Row 1 is bounded by `minmax(0, 1fr)` so the transcript scrolls; row 2 is the
composer's natural height, so it stays pinned to the bottom and never overlays
text.

## Trade-offs

- **`sessions.retain` is required.** On a host that does not expose session
  ownership the panel shows a localized failure plus the underlying message
  instead of rendering.
- **One session per tab.** Closing the tab retires the memory-only session; the
  conversation is not resumed.
- **The snapshot is a snapshot.** Turns the parent adds after the side chat opens
  are invisible to it — the same semantics as Codex.
- **Side chats share the workspace.** They see the same files and tools as the
  main thread; that is the point, and also the risk.
- **Layout leans on `!important`.** The host's own rules outrank a plugin's, so
  the two structural rules above are declared with it. They are scoped to
  `.dsh-side-chat-host` and do not affect the main thread's CSS.

## Verification

Measured against a live host on this machine:

| Check | Result |
|---|---|
| `POST /side-chat/api/open` | 200 in ~100 ms, returns a session id |
| `POST /side-chat/api/close` | 200 |
| `$DSH_HOME/sessions` file count across open/close | **101 → 101, unchanged** |
| Isolated stack mounts, loop registers a factory | confirmed |
| Client bundle discovered and served | confirmed |
| Several side chats per conversation | `multiple: true` on the type |

Not verifiable from a headless host (it needs the app window): that the embedded
surface paints, and that this host exposes `sessions.retain`. If the latter is
missing, the panel says so explicitly.

## Icon

`assets/icon.png` is the product artwork, generated from the same alpha mask the
plugin ships inline (so the README and the running UI cannot drift apart) and
painted with the artwork's own blue, `#586BFD`.

## Uninstall

Remove `plugins/dsh-side-chat/`, drop the dependency and the bundle row from
`package.json`, run `pnpm install`, restart.
