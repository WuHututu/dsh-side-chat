/**
 * `dsh-side-chat` browser half.
 *
 * A side chat is the host's OWN conversation, rendered for its own session: the
 * real transcript (markdown, tool steps, per-turn timing and usage) and the real
 * composer (+ attachments, permission selector, model selector). Nothing about
 * the chat surface is re-implemented here — this plugin only mints a blank
 * session bound to the parent's working directory, hides it from the session
 * list, and mounts the native surface for it in the right Sidebar.
 *
 * That composition is what the host's UI packages already expose:
 * `conversation.content` renders a whole conversation for whichever session the
 * surrounding `SessionProvider` binds, so the tab body only has to supply both.
 *
 * A blank session is used rather than a fork of the parent on purpose: a side
 * chat starts from the workspace, not from the main thread's transcript.
 *
 * Hand-written bundle: the module system only requires that executing this file
 * calls `window.__ModuleLoader__.load({ id, factory })` with the package name.
 * Only `react` is required, and it is a platform seed word.
 */
window.__ModuleLoader__.load({
  id: 'dsh-side-chat',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const react = require('react')
    const h = react.createElement

    /** Locale namespace owned by this plugin. */
    const NS = 'sideChat'
    /** Tab type identity; the slot keys below must equal it. */
    const ID = 'dsh-side-chat'
    /** The page kind opened by the guide card. */
    const KIND = 'sidechat'
    /** Child seat this type owns for the embedded conversation. */
    const CONVERSATION = 'dsh-side-chat.conversation'

    const zh = {
      title: '侧边聊天',
      'guide.title': '侧边聊天',
      'guide.description': '侧边聊天是临时聊天，关闭应用后会消失',
      preparing: '正在准备侧边聊天…',
      prepareFailed: '侧边聊天无法启动',
      noSession: '请先打开一个会话',
    }

    const en = {
      title: 'Side chat',
      'guide.title': 'Side chat',
      'guide.description': 'A temporary conversation that disappears when the app closes',
      preparing: 'Preparing the side chat…',
      prepareFailed: 'The side chat could not start',
      noSession: 'Open a conversation first',
    }

    /**
     * The side-chat glyph: a whale-shaped speech bubble, the product artwork
     * for this feature rather than a generic comment icon.
     *
     * Rendered as an alpha mask (`mask-image`) painted with the artwork's own
     * blue, so the strokes keep the supplied colour and weight.
     */
    const GLYPH_COLOR = '#586BFD'
    const GLYPH_MASK = 'data:image/png;base64,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'

    /** @param root0 - the glyph props. */
    function WhaleBubbleGlyph({ size = 24 }) {
      return h('span', {
        role: 'img',
        'aria-hidden': 'true',
        focusable: 'false',
        style: {
          display: 'inline-block',
          flex: 'none',
          width: size,
          height: size,
          backgroundColor: GLYPH_COLOR,
          WebkitMaskImage: `url(${GLYPH_MASK})`,
          maskImage: `url(${GLYPH_MASK})`,
          WebkitMaskSize: 'contain',
          maskSize: 'contain',
          WebkitMaskRepeat: 'no-repeat',
          maskRepeat: 'no-repeat',
          WebkitMaskPosition: 'center',
          maskPosition: 'center',
        },
      })
    }

    /**
     * The embedded conversation surface.
     *
     * `conversation.content` is the host's own factory seat: given the owner
     * shape the main thread uses, it renders the transcript, the running-turn
     * status and the composer for whatever session the surrounding provider
     * binds. The `views` override names the chat view, which is what the main
     * thread's own content seat does.
     *
     * @param props - the seat props, including `renderFactorySlot`.
     */
    function ConversationContent(props) {
      return props.renderFactorySlot(
        'conversation.content',
        { variant: 'embedded', phase: 'active', hero: false },
        { slots: { views: ChatView } },
      )
    }

    /**
     * The chat view inside that surface: the host's message list.
     * @param props - the view props, including `renderSlot`.
     */
    function ChatView(props) {
      return h(
        'div',
        { className: 'dsh-side-chat-view' },
        props.renderSlot('conversation.session', { view: 'chat' }),
      )
    }

    /** The panel shown while the side session is being prepared, or on failure. */
    function StateScreen(props) {
      return h(
        'div',
        {
          style: {
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            padding: 24,
            textAlign: 'center',
            fontSize: 13,
            color: 'var(--dsw-alias-label-tertiary)',
          },
        },
        h('div', {}, props.title),
        props.detail === undefined
          ? null
          : h(
              'div',
              {
                style: {
                  maxWidth: 360,
                  fontSize: 11,
                  lineHeight: '16px',
                  color: 'var(--dsw-alias-label-danger, #d9534f)',
                  wordBreak: 'break-word',
                },
              },
              props.detail,
            ),
      )
    }

    /**
     * Call the host half.
     *
     * The Desktop shell serves the page from `dsh-app://app/` and forwards every
     * non-asset path to the Host, so a document-relative path reaches it in both
     * the browser and the shell.
     */
    async function callHost(method, payload) {
      const response = await fetch(`/side-chat/api/${method}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload ?? {}),
      })
      const body = await response.json().catch(() => ({ ok: false, error: { code: 'error' } }))
      if (body?.ok !== true) {
        const failure = body?.error
        throw new Error(failure?.message ?? failure?.code ?? `side-chat: ${method} failed`)
      }
      return body.value
    }

    /**
     * Side chats outlive their components.
     *
     * The Sidebar unmounts a tab body whenever the conversation changes or the
     * panel re-lays out, and a side chat must survive that: it comes back when
     * you switch away and return, and it dies only when its own tab closes (or
     * the app exits) — the same lifetime Codex gives one. So the forked session
     * is cached here, keyed by parent conversation + tab, and torn down from the
     * tab record's abort signal rather than from a component unmount.
     */
    const liveChats = new Map()

    /** Cache key for one tab of one conversation. */
    function chatKey(sessionId, tabId) {
      return `${sessionId}\u0000${tabId}`
    }

    /** Fork the parent conversation once per tab, or reuse the existing fork. */
    function ensureChat(key, start) {
      const existing = liveChats.get(key)
      if (existing !== undefined) return existing
      const pending = start()
      liveChats.set(key, pending)
      // A refused fork must not poison the cache: the next mount retries.
      pending.catch(() => {
        if (liveChats.get(key) === pending) liveChats.delete(key)
      })
      return pending
    }

    /** Release one side chat: drop the retained reference and retire its session. */
    function disposeChat(key, services) {
      const pending = liveChats.get(key)
      if (pending === undefined) return
      liveChats.delete(key)
      void pending.then(
        (chat) => {
          try {
            chat.reference.release()
          } catch {
            // Releasing twice is harmless; refusing to release is not.
          }
          // The chat dies with its tab: the host drops the memory-only session.
          void callHost('close', { sessionId: chat.childId }).catch(() => {})
        },
        () => {},
      )
    }

    /** Release every side chat (plugin unload / reload). */
    function disposeAllChats(services) {
      for (const key of [...liveChats.keys()]) disposeChat(key, services)
    }

    /**
     * Full-height flex shell around the embedded conversation.
     *
     * The host's content seat expects to be the growing row of a column: without
     * a sized parent it collapses and the composer ends up pinned to the top of
     * an empty panel.
     */
    /**
     * Layout for the embedded conversation.
     *
     * The bottom padding stands in for the main conversation's status footer
     * (throughput, cache hit rate, context ring): a side chat has no such footer,
     * so without this the same composer sits visibly lower and the panel's total
     * height does not match the main thread.
     */
    const LAYOUT_CSS = `
.dsh-side-chat-host{position:absolute;inset:0;display:flex;flex-direction:column;min-height:0;overflow:hidden}
.dsh-side-chat-host>*{flex:1 1 0%;min-height:0;display:flex;flex-direction:column;position:relative}
/* The host packs the transcript and the composer into ONE scroll body and
   shrinks the composer with flex. Flex shrink is overridden by the host here, so
   the transcript grows to content height and nothing ever scrolls. Grid rows are
   not subject to that negotiation: row 1 is bounded by minmax(0,1fr), row 2 is
   the composer's natural height. */
.dsh-side-chat-host [data-conversation-scroll]{
  display:grid!important;
  grid-template-rows:minmax(0,1fr) auto;
  min-height:0;
  overflow:hidden;
}
.dsh-side-chat-host [data-conversation-scroll] > *{min-height:0}
.dsh-side-chat-view{
  display:flex;
  flex-direction:column;
  min-height:0!important;
  overflow-y:auto!important;
}
.dsh-side-chat-host [data-conversation-region="composer"]{
  position:static!important;
  flex:0 0 auto;
  z-index:auto;
}
/* The stats row (throughput, cache hit, context) lives in the composer dock and
   collapses while empty, so the composer sat lower until the first turn produced
   usage and then jumped up. Reserve its height in both states. */
.dsh-side-chat-host [data-composer-dock]{min-height:22px}
`

    /** Inject the layout stylesheet once per page. */
    function installStyles() {
      if (typeof document === 'undefined') return
      const id = 'dsh-side-chat/layout.css'
      if (document.querySelector(`style[data-plugin-css=${JSON.stringify(id)}]`) !== null) return
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-side-chat'
      tag.dataset.pluginCss = id
      tag.textContent = LAYOUT_CSS
      document.head.appendChild(tag)
    }

    /**
     * The tab body.
     *
     * Forks the parent conversation once per tab — Codex's snapshot semantics:
     * the side chat can read what was said before it opened, cannot see later
     * turns, and cannot rewrite the main thread — then mounts the host's own
     * conversation on it.
     *
     * @param props - the seat props plus this plugin's injected services.
     */
    function SideChatBody(props) {
      const { ctx, sessions, sessionId, t, renderSlot, SessionProvider } = props
      const [state, setState] = react.useState({ phase: 'preparing' })
      const tab = props.useTabInfo === undefined ? undefined : props.useTabInfo()?.tab
      const tabId = tab?.id
      const key = chatKey(sessionId, tabId)

      react.useEffect(() => {
        // Until the tab record is known there is no cache key to fork under;
        // forking now would mint a second session the moment it resolves.
        if (tabId === undefined) return undefined
        let live = true
        ensureChat(key, async () => {
          // The host mints the chat: a memory-only session whose prompt carries
          // the parent snapshot. Nothing is written to disk and the transcript
          // starts empty.
          const { sessionId: childId } = await callHost('open', { parentSessionId: sessionId })
          const liveSessions = (typeof ctx?.get === 'function' ? ctx.get('sessions') : undefined) ?? sessions
          const reference = liveSessions.retain?.(childId, { source: ID })
          if (reference === undefined) {
            throw new Error('this host does not expose session ownership (sessions.retain)')
          }
          return { childId, reference }
        }).then(
          (chat) => {
            if (live) setState({ phase: 'ready', reference: chat.reference })
          },
          (error) => {
            if (live) {
              setState({
                phase: 'error',
                detail: error instanceof Error ? error.message : String(error),
              })
            }
          },
        )
        // Unmount is not closure: switching conversations must keep the chat.
        return () => {
          live = false
        }
      }, [ctx, sessions, key, sessionId])

      // Real closure is the tab record going away, not this component unmounting.
      const tabSignal = tab?.signal
      react.useEffect(() => {
        if (tabSignal === undefined) return undefined
        const onAbort = () => { disposeChat(key, ctx) }
        if (tabSignal.aborted === true) {
          onAbort()
          return undefined
        }
        tabSignal.addEventListener('abort', onAbort, { once: true })
        return () => { tabSignal.removeEventListener('abort', onAbort) }
      }, [key, tabSignal, ctx])

      if (state.phase === 'error') {
        return h(StateScreen, { title: t('prepareFailed'), detail: state.detail })
      }
      if (state.phase === 'preparing') return h(StateScreen, { title: t('preparing') })
      return h(
        'div',
        { className: 'dsh-side-chat-host' },
        h(SessionProvider, { session: state.reference }, renderSlot(CONVERSATION, {})),
      )
    }

    /** The tab chip: the glyph plus the type's name. */
    function SideChatTitle(props) {
      const { t } = props
      return h(
        'span',
        { style: { display: 'inline-flex', alignItems: 'center', gap: 6 } },
        h(WhaleBubbleGlyph, { size: 16 }),
        t('title'),
      )
    }

    /** Services this client plugin needs. */
    const inject = ['slots', 'locale', 'sidebarRight', 'sidebarRightTabs', 'shortcuts']

    /**
     * Register the page type, its seats, the guide card and the shortcut.
     * @param ctx - the client root context.
     */
    function apply(ctx) {
      const t = ctx.locale.bind(NS)
      // Resolved at call time rather than through `static inject`: the Sidebar
      // entry must register even when a data service is missing, and a hard
      // dependency would leave the whole client plugin PENDING instead.
      const sessions = typeof ctx.get === 'function' ? ctx.get('sessions') : undefined

      installStyles()

      // A plugin reload must not leak the forks it is holding.
      ctx.effect(() => () => disposeAllChats(ctx), 'dsh-side-chat: dispose')

      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-side-chat: copy')

      // The page type. `commandId` is what makes the guide card render the
      // shortcut keys on its right edge.
      ctx.effect(
        () =>
          ctx.sidebarRightTabs.register({
            id: ID,
            kind: KIND,
            priority: 'extension',
            // Without this the Sidebar addresses the page by KIND alone, so every
            // "new side chat" in one conversation resolves to the same tab and the
            // first chat is all you can ever have. `multiple` mints a per-open
            // address instead.
            multiple: true,
            title: () => t('title'),
            guide: [
              {
                id: 'new',
                commandId: 'sidechat.new',
                order: 40,
                title: () => t('guide.title'),
                description: () => t('guide.description'),
                icon: WhaleBubbleGlyph,
              },
            ],
          }),
        'dsh-side-chat: type',
      )

      // Body. `children` declares the conversation seat this type owns, so the
      // body can render the host's conversation inside its own subtree.
      ctx.effect(
        () =>
          ctx.slots.inject(
            'sidebar.right.pane.tab',
            () =>
              ctx.slots.register(
                {
                  name: 'sidebar.right.pane.tab',
                  key: ID,
                  locale: NS,
                  children: { [CONVERSATION]: { kind: 'single', scope: 'session' } },
                  inject: (sessionId) => ({ ctx, sessions, sessionId }),
                },
                SideChatBody,
              ),
          ),
        'dsh-side-chat: body',
      )

      // The seat the body renders under its own `SessionProvider`.
      ctx.effect(
        () =>
          ctx.slots.inject(
            CONVERSATION,
            () => ctx.slots.register({ name: CONVERSATION }, ConversationContent),
          ),
        'dsh-side-chat: conversation',
      )

      ctx.effect(
        () =>
          ctx.slots.inject(
            'sidebar.right.pane.tab.title',
            () =>
              ctx.slots.register(
                { name: 'sidebar.right.pane.tab.title', key: ID, locale: NS },
                SideChatTitle,
              ),
          ),
        'dsh-side-chat: title',
      )

      // Ctrl+Alt+S. `primary` is Control on Windows/Linux and Command on macOS;
      // the shortcut service throws on a conflicting default, so "if unbound"
      // is enforced by the platform rather than assumed here.
      ctx.effect(
        () =>
          ctx.shortcuts.register({
            id: 'sidechat.new',
            label: () => t('guide.title'),
            aliases: ['side chat'],
            defaults: {
              'desktop:windows': { code: 'KeyS', modifiers: ['primary', 'alt'] },
              'desktop:macos': { code: 'KeyS', modifiers: ['primary', 'alt'] },
              'desktop:linux': { code: 'KeyS', modifiers: ['primary', 'alt'] },
              'web:windows': { code: 'KeyS', modifiers: ['primary', 'alt'] },
              'web:macos': { code: 'KeyS', modifiers: ['primary', 'alt'] },
            },
            regions: ['page', 'editable', 'terminal'],
            modals: [],
            resolve: ({ target: element }) => {
              const target = ctx.sidebarRight.commandTarget(element)
              if (target === undefined) return { status: 'blocked', reason: t('noSession') }
              return {
                status: 'handled',
                run: () => {
                  ctx.sidebarRight.openTabFromTarget(KIND, target)
                },
              }
            },
          }),
        'dsh-side-chat: shortcut',
      )
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
