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
      askSideChat: '在侧边聊天中提问',
      quoteCountOne: '{count} 个已选文本片段',
      quoteCountMany: '{count} 个已选文本片段',
      quoteClear: '清除引用',
      quoteFailed: '失败',
    }

    const en = {
      title: 'Side chat',
      'guide.title': 'Side chat',
      'guide.description': 'A temporary conversation that disappears when the app closes',
      preparing: 'Preparing the side chat…',
      prepareFailed: 'The side chat could not start',
      noSession: 'Open a conversation first',
      askSideChat: 'Ask in side chat',
      quoteCountOne: '{count} selected fragment',
      quoteCountMany: '{count} selected fragments',
      quoteClear: 'Clear quotes',
      quoteFailed: 'failed',
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
          setCards(chat.childId, [])
          forgetSendState(chat.childId)
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
.dsh-side-chat-toolbar{position:fixed;z-index:9000;display:flex;gap:4px;padding:3px;transform:translate(-50%,calc(-100% - 8px));border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-3,#26282e);border:0.5px solid var(--dsw-alias-border-l3);box-shadow:var(--dsw-elevation-soft,0 6px 20px rgba(0,0,0,.35))}
.dsh-side-chat-toolbar[hidden]{display:none}
.dsh-side-chat-toolbar-button{display:inline-flex;align-items:center;padding:4px 10px;border:0;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;white-space:nowrap;cursor:pointer}
.dsh-side-chat-toolbar-button:hover{background:var(--dsw-alias-interactive-bg-hover)}
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
/* The quote pill lives INSIDE the composer card, above the text line. The host's
   overlay anchor is zero-height and absolutely placed, so the card itself
   reserves the room: it grows exactly as it would for an attachment, and the
   editor never slides under the pill. */
[data-composer-card]:has(.dsh-side-chat-pill){padding-top:42px}
.dsh-side-chat-pill-wrap{display:flex;min-width:0;padding:10px 12px 0}
/* cursor: default, because the composer sets a text caret over its whole card but
   the pill is a control and must not look like a place to type. */
.dsh-side-chat-pill{display:inline-flex;align-items:center;gap:6px;width:fit-content;max-width:100%;padding:2px 3px 2px 8px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:999px;background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));color:var(--dsw-alias-label-primary);font-size:12px;line-height:18px;cursor:default;transition:background-color .16s ease,border-color .16s ease,box-shadow .16s ease}
.dsh-side-chat-pill:hover{background:var(--dsw-alias-interactive-bg-active,rgba(255,255,255,.14));border-color:var(--dsw-alias-border-l2,rgba(255,255,255,.2))}
.dsh-side-chat-pill-icon{flex:none;opacity:.7;transition:opacity .16s ease}
.dsh-side-chat-pill:hover .dsh-side-chat-pill-icon{opacity:1}
.dsh-side-chat-pill-count{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-side-chat-pill-clear{flex:none;display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;padding:0;border:0;border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1;cursor:pointer}
.dsh-side-chat-pill-clear:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dsh-side-chat-pill-failed{border-color:var(--dsw-alias-status-danger,#d9534f)}
/* A sent quote message: the label the plugin wrote is hidden, the bubble that only
   held it is hidden too, and the same text is drawn as the pill above it. The row
   keeps a strip of height so the pill never overlaps the next message. */
[data-dsh-quote-label]{display:none!important}
[data-dsh-quote-row]{position:relative!important;min-height:30px!important}
[data-dsh-quote-row] > :has([data-dsh-quote-label]){display:none!important}
.dsh-side-chat-sent-pill{position:absolute;top:0;right:0;display:inline-flex;align-items:center;gap:4px;padding:2px 10px 2px 8px;border:0.5px solid var(--dsw-alias-border-l3);border-radius:999px;background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));font-size:12px;line-height:18px;white-space:nowrap}
.dsh-side-chat-sent-pill::before{content:"“";opacity:.55;font-weight:600}
.dsh-side-chat-sent-pill::after{content:"”";opacity:.55;font-weight:600}
/* Hover reveal: the passages themselves, one quoted passage per line, each
   clamped to three lines. The text cursor is deliberate: the revealed quote is
   selectable copy, unlike the pill that opens it. */
.dsh-side-chat-quote-popover{position:fixed;z-index:9000;display:flex;flex-direction:column;gap:8px;max-height:320px;padding:10px 12px;overflow:auto;border:0.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-3,#26282e);box-shadow:var(--dsw-elevation-soft,0 6px 20px rgba(0,0,0,.35));font-size:12.5px;line-height:1.55;cursor:text;animation:dsh-side-chat-reveal-in .14s ease-out}
@keyframes dsh-side-chat-reveal-in{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.dsh-side-chat-quote-reveal{min-width:0;color:var(--dsw-alias-label-primary)}
.dsh-side-chat-quote-reveal-text{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:3;line-clamp:3;overflow:hidden;white-space:pre-wrap;overflow-wrap:anywhere}
.dsh-side-chat-quote-reason{margin-top:2px;font-size:11px;line-height:16px;color:var(--dsw-alias-status-danger,#d9534f);word-break:break-word}
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
            if (live) setState({ phase: 'ready', reference: chat.reference, childId: chat.childId })
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

      // A quote queued for this conversation is handed to the chat as soon as the
      // chat has a session id to attach it to, whether that arrives first.
      const [quoteTick, setQuoteTick] = react.useState(0)
      react.useEffect(
        () => watchQuotes(sessionId, () => setQuoteTick((count) => count + 1)),
        [sessionId],
      )
      react.useEffect(() => {
        if (state.phase !== 'ready' || state.childId === undefined) return undefined
        flushQuotes(sessionId, state.childId)
        return undefined
      }, [sessionId, state.phase, state.childId, quoteTick])

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

    /** The empty list, so a session with no cards keeps one stable identity. */
    const EMPTY_QUOTES = []
    /**
     * Zero-width space: the host will not submit an empty draft, so a quote-only
     * send needs a character that renders as nothing.
     */
    const QUOTE_MARKER = '\u200B'

    /** The draft each composer last published, so a host reset reads as a send. */
    const lastDrafts = new Map()
    /** Clears waiting for a sent turn's prompt to assemble, by chat session. */
    const pendingSendClears = new Map()

    /**
     * Clear one chat's quotes a beat after its turn was sent.
     *
     * The prompt section is read while the turn starts, so the clear is deferred
     * rather than raced against that assembly. The timer lives outside the
     * component: the composer can remount mid-send, and a per-render timer would
     * be dropped along with it.
     *
     * @param sideSessionId - the chat whose turn was just sent.
     */
    function scheduleSendClear(sideSessionId) {
      if (pendingSendClears.has(sideSessionId)) return
      const timer = setTimeout(() => {
        pendingSendClears.delete(sideSessionId)
        clearQuotes(sideSessionId)
      }, 1500)
      pendingSendClears.set(sideSessionId, timer)
    }

    /**
     * Forget a chat's send bookkeeping, so a closed chat leaves nothing behind.
     *
     * @param sideSessionId - the chat being closed.
     */
    function forgetSendState(sideSessionId) {
      const timer = pendingSendClears.get(sideSessionId)
      if (timer !== undefined) clearTimeout(timer)
      pendingSendClears.delete(sideSessionId)
      lastDrafts.delete(sideSessionId)
    }

    /** The box a hovered card should anchor its revealed text to. */
    function anchorOf(element) {
      if (element === null || element === undefined || typeof element.getBoundingClientRect !== 'function') {
        return null
      }
      const rect = element.getBoundingClientRect()
      return { left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width }
    }

    /**
     * Place the reveal above the pill, or below when it would be clipped.
     *
     * Width follows the passage — a short quote gets a short panel — and is capped
     * at twice the pill so one long quote cannot cover the whole conversation.
     * `position: fixed` because the composer's own ancestors clip: an absolutely
     * positioned panel would be cut off at the card.
     *
     * @param anchor - the hovered pill's viewport box.
     * @param pillWidth - the pill's measured width, used for the cap.
     * @returns inline styles for the reveal panel.
     */
    function popoverStyle(anchor, pillWidth) {
      const viewport = typeof window === 'undefined' ? {} : window
      const right = viewport.innerWidth ?? 960
      const height = viewport.innerHeight ?? 640
      const cap = Math.max(180, Math.min(pillWidth * 2, right - 16))
      const style = {
        left: Math.max(8, Math.min(anchor.left, right - cap - 8)),
        width: 'max-content',
        maxWidth: cap,
      }
      if (anchor.top > 240) style.bottom = Math.max(8, height - anchor.top + 8)
      else style.top = anchor.bottom + 8
      return style
    }

    /** The pill's glyph: a text block, the same idea as Codex's fragment icon. */
    function QuotePillGlyph() {
      return h(
        'svg',
        {
          className: 'dsh-side-chat-pill-icon',
          viewBox: '0 0 16 16',
          width: 14,
          height: 14,
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('rect', {
          x: 2.6,
          y: 2.6,
          width: 10.8,
          height: 10.8,
          rx: 3,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.2,
        }),
        h('path', {
          d: 'M5.6 6.4h4.8M5.6 9.6h3.1',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.2,
          strokeLinecap: 'round',
        }),
      )
    }

    /**
     * Give a sent quote message the pill it stands for, above the bubble.
     *
     * The transcript renders user messages as plain text and exposes no slot for a
     * custom node, so the row is found by a leaf holding only our label: the label
     * is hidden and a pill carrying the same text is inserted ahead of the bubble.
     * The pass is idempotent and re-runs on transcript mutations, because React
     * owns that subtree and may rebuild it; markup that stops matching simply
     * leaves the message as plain text.
     *
     * @param root - subtree to scan.
     */
    function markQuoteMessages(root) {
      if (typeof root?.querySelectorAll !== 'function') return
      if (typeof document === 'undefined' || typeof document.createElement !== 'function') return
      const label = /^\d+\s*(个已选文本片段|selected fragments?)$/u
      for (const row of root.querySelectorAll('[data-chat-flow-kind="user"]')) {
        if (row.hasAttribute?.('data-dsh-quote-row') === true) continue
        let leaf = null
        for (const element of row.querySelectorAll('*')) {
          if (element.children.length > 0) continue
          if (!label.test(String(element.textContent ?? '').trim())) continue
          leaf = element
          break
        }
        if (leaf === null) continue
        const pill = document.createElement('div')
        pill.className = 'dsh-side-chat-sent-pill'
        pill.setAttribute('data-dsh-side-chat', '')
        pill.textContent = String(leaf.textContent ?? '').trim()
        row.insertBefore(pill, row.firstChild)
        // Marked only after the pill is in place: hiding the label without drawing a
        // replacement would delete the message.
        row.setAttribute('data-dsh-quote-row', '')
        leaf.setAttribute('data-dsh-quote-label', '')
      }
    }

    /**
     * The quote pill, handed to the host to render inside the composer card.
     *
     * The host's overlay anchor is zero-height and absolutely placed, so the pill
     * floats at the card's top edge while a `:has()` rule on the card reserves the
     * room for it: the card grows exactly as it does for an attachment, and the
     * editor never slides under the pill.
     *
     * It carries only the count, sized to its own text, because a composer is not
     * a transcript: the passages themselves come back on hover, three lines each.
     * The slot is session-scoped and shared with the main conversation, so nothing
     * is returned for a session this plugin did not open.
     *
     * @param props - the host's overlay props, including `sessionId`.
     */
    function QuoteDock(props) {
      const quotes = react.useSyncExternalStore(subscribeCards, getCards).get(props.sessionId) ?? EMPTY_QUOTES
      const [anchor, setAnchor] = react.useState(null)
      const [pillWidth, setPillWidth] = react.useState(0)
      const closeTimer = react.useRef(null)
      const wrapRef = react.useRef(null)
      const input = typeof props.useInput === 'function' ? props.useInput((state) => state) : undefined
      const actions = props.inputActions
      const phase = input?.phase ?? 'plain'
      const draft = typeof input?.draft === 'string' ? input.draft : ''

      // A sent turn consumes its quotes.
      //
      // The submit machine goes plain → adjudicating → submitting → plain inside
      // one tick, and React only ever renders the last of those, so `phase` alone
      // never reports a send. The draft it leaves behind does: the host clears the
      // editor when it accepts the turn, which turns our marker (or the user's
      // text) into an empty draft. This runs before the marker effect so the marker
      // is not re-inserted into the draft the host just reset.
      react.useEffect(() => {
        const previous = lastDrafts.get(props.sessionId)
        lastDrafts.set(props.sessionId, draft)
        if (quotes.length === 0) return
        const sent = previous !== undefined && previous.trim() !== '' && draft.trim() === ''
        if (!sent && phase === 'plain') return
        scheduleSendClear(props.sessionId)
      }, [draft, phase, quotes.length, props.sessionId])

      // The host refuses to submit an empty draft, and a send made of nothing but
      // quotes has to be possible: a zero-width marker is invisible in the editor
      // but counts as content, so the composer's own send button lights up.
      react.useEffect(() => {
        if (quotes.length === 0 || draft.trim() !== '') return
        // A send is in flight and the host is about to reset the draft; putting the
        // marker back now would fight that reset and keep the pill alive.
        if (pendingSendClears.has(props.sessionId)) return
        if (typeof actions?.setDraft !== 'function') return
        actions.setDraft(QUOTE_MARKER)
      }, [quotes.length, draft, actions, props.sessionId])

      // The marker is ours, so it leaves when the last quote leaves: an empty
      // composer must look empty again.
      react.useEffect(() => {
        if (quotes.length !== 0 || draft !== QUOTE_MARKER) return
        if (typeof actions?.setDraft === 'function') actions.setDraft('')
      }, [quotes.length, draft, actions])

      // A sent turn consumes its quotes.
      //
      // The user message the host sends IS the draft, so a send that carries quotes
      // has to rewrite the draft at the moment the send is requested. The zero-width
      // marker is what keeps the send control enabled meanwhile; here it is stripped
      // and replaced by the passages themselves, which is what makes them show up in
      // the bubble instead of an empty one.
      react.useEffect(() => {
        if (quotes.length === 0) return undefined
        const wrap = wrapRef.current
        const card = typeof wrap?.closest === 'function' ? wrap.closest('[data-composer-card]') : null
        if (card === null || card === undefined) return undefined
        const takeOver = (event) => {
          if (event.isComposing === true) return
          const isClick = event.type === 'click'
          const isEnter = event.type === 'keydown' && event.key === 'Enter' && event.shiftKey !== true
          if (!isClick && !isEnter) return
          if (isClick) {
            const button = typeof event.target?.closest === 'function' ? event.target.closest('button') : null
            // Only the composer's own primary control sends; the attachment, model
            // and permission controls share the row and must stay untouched.
            if (button === null || !String(button.className).includes('primary')) return
          }
          const typed = draft.split(QUOTE_MARKER).join('').trim()
          // The transcript renders user messages as plain text, so the message body
          // is the pill's own label — no markdown, which would show its syntax — and
          // the DOM pass below restyles that text into the pill. The passages reach
          // the model through the prompt section, not through the bubble.
          const label = textFor(quotes.length === 1 ? 'quoteCountOne' : 'quoteCountMany')
            .replace('{count}', String(quotes.length))
          const text = typed === '' ? label : `${label}\n\n${typed}`
          event.preventDefault()
          event.stopPropagation()
          actions.setDraft(text)
          // The host reads the draft it published, so the submit waits for that
          // write to land rather than racing it inside the same event.
          setTimeout(() => { actions.submit() }, 0)
        }
        card.addEventListener('click', takeOver, true)
        card.addEventListener('keydown', takeOver, true)
        return () => {
          card.removeEventListener('click', takeOver, true)
          card.removeEventListener('keydown', takeOver, true)
        }
      }, [quotes, draft, actions])

      const cancelClose = () => {
        if (closeTimer.current !== null) {
          clearTimeout(closeTimer.current)
          closeTimer.current = null
        }
      }
      // The reveal sits a few pixels above the pill, so the pointer crosses a gap
      // on its way there. Closing on the first mouseleave wins that race far too
      // often, so the close is deferred and cancelled by the next enter.
      const scheduleClose = () => {
        cancelClose()
        closeTimer.current = setTimeout(() => {
          closeTimer.current = null
          setAnchor(null)
        }, 220)
      }
      // The pill is the trigger, not the row it sits in: the row spans the whole
      // card width and hovering its empty end must do nothing.
      const openReveal = (pill) => {
        cancelClose()
        const rect = anchorOf(pill)
        if (rect === null) {
          setAnchor(null)
          return
        }
        setPillWidth(rect.width)
        setAnchor(rect)
      }

      // The reveal is positioned against the viewport, so scrolling away from the
      // pill has to dismiss it rather than leave it floating over other text.
      react.useEffect(() => {
        if (anchor === null) return undefined
        const dismiss = () => {
          cancelClose()
          setAnchor(null)
        }
        document.addEventListener('scroll', dismiss, true)
        window.addEventListener('resize', dismiss)
        return () => {
          document.removeEventListener('scroll', dismiss, true)
          window.removeEventListener('resize', dismiss)
        }
      }, [anchor])
      react.useEffect(() => () => {
        cancelClose()
      }, [])
      if (quotes.length === 0) return null
      const failed = quotes.some((quote) => quote.error !== undefined)
      const label = textFor(quotes.length === 1 ? 'quoteCountOne' : 'quoteCountMany')
        .replace('{count}', String(quotes.length))
      return h(
        'div',
        {
          className: 'dsh-side-chat-pill-wrap',
          'data-dsh-side-chat': '',
          ref: wrapRef,
        },
        h(
          'div',
          {
            className: failed ? 'dsh-side-chat-pill dsh-side-chat-pill-failed' : 'dsh-side-chat-pill',
            onMouseEnter: (event) => openReveal(event.currentTarget),
            onMouseLeave: scheduleClose,
            // The card focuses its editor on mousedown, and an empty composer
            // treats a click as "pick a workspace": the pill is a control, not the
            // card, so its own events stop here.
            onMouseDown: (event) => event.stopPropagation(),
            onClick: (event) => event.stopPropagation(),
          },
          h(QuotePillGlyph),
          h('span', { className: 'dsh-side-chat-pill-count' }, label),
          h('button', {
            type: 'button',
            className: 'dsh-side-chat-pill-clear',
            title: textFor('quoteClear'),
            'aria-label': textFor('quoteClear'),
            onClick: () => clearQuotes(props.sessionId),
          }, '×'),
        ),
        anchor === null
          ? null
          : h(
              'div',
              {
                className: 'dsh-side-chat-quote-popover',
                'data-dsh-side-chat': '',
                style: popoverStyle(anchor, pillWidth),
                onMouseEnter: cancelClose,
                onMouseLeave: scheduleClose,
              },
              quotes.map((quote) => h(
                'div',
                { key: quote.id, className: 'dsh-side-chat-quote-reveal' },
                // Each passage stands on its own line but is not re-identified:
                // quotes carry the separation, order carries the numbering.
                h('div', { className: 'dsh-side-chat-quote-reveal-text' }, `“${quote.text.trim()}”`),
                quote.error === undefined
                  ? null
                  : h('div', { className: 'dsh-side-chat-quote-reason' }, `${textFor('quoteFailed')}: ${quote.error}`),
              )),
            ),
      )
    }

    // ── Selection → side chat ────────────────────────────────────────────────
    //
    // Selecting part of an assistant answer opens the conversation's side chat
    // with that passage quoted: it appears as a card above the chat's composer
    // and joins its context, so the input box stays free for the question. The
    // quote never auto-submits: the user always adds the ask.

    /** The host's own markers for one completed assistant message. */
    const ASSISTANT_STEP = 'assistant-step'
    /** `data-dsh-side-chat`: the attribute that marks this plugin's own DOM. */
    const OWN_KEY = 'dshSideChat'
    /** How long a quote waits for its panel to mount, in milliseconds. */
    const QUOTE_TTL_MS = 15000

    /** Quotes captured before their panel exists, oldest first. */
    const pendingQuotes = []

    /** Populated by `apply`; the client session face, for scope lookups. */
    let sessionsRef
    /** Populated by `apply`; resolves this plugin's copy in the active language. */
    let textFor = (key) => key

    /** True when `node` sits inside an assistant answer we are allowed to quote. */
    function quoteHostOf(node) {
      let element = node !== null && node.nodeType === 3 ? node.parentElement : node
      if (element === null || element === undefined || typeof element.closest !== 'function') return null
      // Quoting our own toolbar, or anything the plugin renders, is meaningless
      // and would let the overlay dismiss itself the instant it is used.
      if (element.closest('[data-dsh-side-chat]') !== null) return null
      const body = element.closest('[data-chat-flow-kind="' + ASSISTANT_STEP + '"]')
      if (body === null) return null
      // A streaming answer is still being written; quoting mid-flight captures a
      // fragment of text the user never saw settled.
      if (body.hasAttribute('data-streaming')) return null
      return body
    }

    /**
     * Read the live selection, or null when it is not quotable.
     *
     * Both endpoints must fall inside the SAME assistant message: a drag that
     * crosses two answers (or the whole thread) selects more than the user meant
     * to ask about, so the toolbar stays hidden.
     */
    function captureSelection() {
      const selection = typeof window.getSelection === 'function' ? window.getSelection() : null
      if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return null
      const range = selection.getRangeAt(0)
      const start = quoteHostOf(range.startContainer)
      const end = quoteHostOf(range.endContainer)
      if (start === null || end === null || start !== end) return null
      const text = selection.toString().trim()
      if (text === '') return null
      const rect = range.getBoundingClientRect()
      return { text, left: rect.left + rect.width / 2, top: rect.top }
    }

    /** Take every quote queued for this conversation, clearing them from the queue. */
    function takeQuotes(parentSessionId) {
      const now = Date.now()
      while (pendingQuotes.length > 0 && now - pendingQuotes[0].at > QUOTE_TTL_MS) pendingQuotes.shift()
      const taken = []
      for (let index = pendingQuotes.length - 1; index >= 0; index -= 1) {
        if (pendingQuotes[index].parentSessionId === parentSessionId) {
          taken.unshift(pendingQuotes[index].text)
          pendingQuotes.splice(index, 1)
        }
      }
      return taken
    }

    /** Watchers waiting for the next quote of one conversation. */
    const quoteWatchers = new Map()

    /**
     * Tell any panel already showing this conversation that a quote arrived.
     * Without this, a quote taken while the tab is already open would stay in the
     * queue, because nothing re-runs the panel's delivery effect.
     *
     * @param parentSessionId - the conversation the quote came from.
     */
    function wakeQuotes(parentSessionId) {
      for (const wake of [...(quoteWatchers.get(parentSessionId) ?? [])]) wake()
    }

    /**
     * Register one panel's interest in a conversation's quotes.
     *
     * @param parentSessionId - the conversation to watch.
     * @param wake - called when a quote is queued for it.
     * @returns a disposer.
     */
    function watchQuotes(parentSessionId, wake) {
      let watchers = quoteWatchers.get(parentSessionId)
      if (watchers === undefined) {
        watchers = new Set()
        quoteWatchers.set(parentSessionId, watchers)
      }
      watchers.add(wake)
      return () => {
        watchers.delete(wake)
      }
    }

    /**
     * The cards each open side chat is showing, keyed by its own session id.
     *
     * One immutable map swapped on every change, subscribed to through one stable
     * pair of functions: a per-session store created when the first quote arrives
     * would be a store the dock was never subscribed to, and the card would stay
     * invisible until something else re-rendered it.
     */
    let cardsBySession = new Map()
    const cardListeners = new Set()

    /** @returns the current card map. */
    function getCards() {
      return cardsBySession
    }

    /**
     * Watch for any card change in any chat.
     * @param listener - called after a change has been published.
     * @returns a disposer.
     */
    function subscribeCards(listener) {
      cardListeners.add(listener)
      return () => {
        cardListeners.delete(listener)
      }
    }

    /**
     * Publish one chat's cards.
     *
     * @param sideSessionId - the chat whose cards changed.
     * @param next - the new list; an empty list removes the chat's entry.
     */
    function setCards(sideSessionId, next) {
      const updated = new Map(cardsBySession)
      if (next.length === 0) updated.delete(sideSessionId)
      else updated.set(sideSessionId, next)
      cardsBySession = updated
      for (const listener of [...cardListeners]) listener()
    }

    /**
     * Show a quote as a card and make it part of the chat's context.
     *
     * The passage goes to the host, which keeps it in a prompt section the side
     * chat re-reads on every step, rather than into the input box: quoting should
     * not consume the space where the question is typed, and it should not be
     * re-sent as part of the user's own words.
     *
     * @param sideSessionId - the chat receiving the quote.
     * @param text - the selected passage.
     * @returns resolves once the host has taken it.
     */
    async function addQuote(sideSessionId, text) {
      const cards = cardsBySession.get(sideSessionId) ?? []
      const quote = { id: `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, text }
      setCards(sideSessionId, [...cards, quote])
      try {
        await callHost('quote/add', { sessionId: sideSessionId, id: quote.id, text })
      } catch (error) {
        // Keep the card and say what went wrong: a quote that silently vanishes
        // looks exactly like a feature that was never wired up.
        const reason = error instanceof Error ? error.message : String(error)
        const shown = (cardsBySession.get(sideSessionId) ?? []).map((item) =>
          item.id === quote.id ? { ...item, error: reason } : item,
        )
        setCards(sideSessionId, shown)
      }
    }

    /**
     * Drop every quote of one chat — what the pill's own × does.
     *
     * @param sideSessionId - the chat to clear.
     */
    function clearQuotes(sideSessionId) {
      const quotes = cardsBySession.get(sideSessionId) ?? []
      setCards(sideSessionId, [])
      for (const quote of quotes) {
        callHost('quote/remove', { sessionId: sideSessionId, id: quote.id }).catch(() => undefined)
      }
    }

    /** The conversation the Sidebar is currently bound to. */
    function currentParentSession(ctx) {
      const owner = typeof document.querySelector === 'function'
        ? document.querySelector('[data-sidebar-right-session]')
        : null
      const fromDom = owner?.dataset?.sidebarRightSession
      if (typeof fromDom === 'string' && fromDom !== '') return fromDom
      try {
        const current = sessionsRef?.list?.getSnapshot?.()?.current
        if (typeof current === 'string' && current !== '') return current
        if (typeof current?.sessionId === 'string') return current.sessionId
      } catch {
        // An unreadable store just means there is nothing to attribute to.
      }
      return undefined
    }

    /**
     * Deliver a waiting quote once the panel's chat exists.
     *
     * @param parentSessionId - the conversation the quote was taken from.
     * @param sideSessionId - the side chat that is now showing in the panel.
     */
    function flushQuotes(parentSessionId, sideSessionId) {
      for (const text of takeQuotes(parentSessionId)) {
        addQuote(sideSessionId, text).catch((error) => {
          console.warn('[dsh-side-chat] quote delivery failed:', error)
        })
      }
    }

    /** Live selection the toolbar is currently offering, if any. */
    let offered = null

    /**
     * Start the selection watcher and its floating action.
     *
     * One document-level listener set plus one fixed-position element: the
     * toolbar is plain DOM rather than a React root, because a single button does
     * not need a reconciler and the bundle ships without a build step.
     *
     * @param ctx - the client root context.
     * @param t - the localized text resolver.
     */
    function startSelectionBar(ctx, t) {
      if (typeof document === 'undefined' || document.body === undefined || document.body === null) return

      const bar = document.createElement('div')
      bar.dataset[OWN_KEY] = ''
      bar.className = 'dsh-side-chat-toolbar'
      bar.hidden = true

      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'dsh-side-chat-toolbar-button'
      bar.appendChild(button)
      document.body.appendChild(bar)

      const hide = () => {
        offered = null
        bar.hidden = true
      }

      const show = (selection) => {
        // Resolved at show time: the locale table is registered by a later
        // effect, and the interface language can change while the bar exists, so
        // a label captured at start-up would go stale.
        button.textContent = t('askSideChat')
        offered = selection
        bar.hidden = false
        // The rect is viewport-relative, so the bar is positioned fixed.
        bar.style.left = `${Math.max(60, selection.left)}px`
        bar.style.top = `${Math.max(44, selection.top)}px`
      }

      let debounce
      const recompute = () => {
        let selection = null
        try {
          selection = captureSelection()
        } catch {
          selection = null
        }
        if (selection === null) hide()
        else show(selection)
      }
      const schedule = () => {
        clearTimeout(debounce)
        debounce = setTimeout(recompute, 200)
      }

      button.addEventListener('mousedown', (event) => {
        // Without this, focusing the button lands as a selection change that
        // hides the toolbar before the click can register.
        event.preventDefault()
      })
      button.addEventListener('click', () => {
        const quote = offered?.text
        hide()
        // Drop the selection once the quote is taken: a live selection keeps the
        // bar eligible and leaves the source text highlighted for no reason.
        try {
          window.getSelection?.()?.removeAllRanges?.()
        } catch {
          // A selection that refuses to clear is cosmetic; keep the quote.
        }
        if (quote === undefined) return
        const target = ctx.sidebarRight.commandTarget(null)
        if (target === undefined) return
        const parentSessionId = currentParentSession(ctx)
        // Queue before opening: a panel that does not exist yet pulls the quote
        // out when its chat is created, and `wakeQuotes` covers the panel that
        // already exists, whose delivery effect has nothing new to depend on.
        pendingQuotes.push({ text: quote, parentSessionId, at: Date.now() })
        ctx.sidebarRight.openTabFromTarget(KIND, target)
        wakeQuotes(parentSessionId)
      })

      document.addEventListener('selectionchange', schedule)
      document.addEventListener('mouseup', schedule)
      document.addEventListener('keyup', schedule)
      // A scrolled-away selection would otherwise leave the bar floating over
      // unrelated text; the next selection change brings it back.
      document.addEventListener('scroll', hide, true)
      window.addEventListener('resize', hide)

      return () => {
        clearTimeout(debounce)
        document.removeEventListener('selectionchange', schedule)
        document.removeEventListener('mouseup', schedule)
        document.removeEventListener('keyup', schedule)
        document.removeEventListener('scroll', hide, true)
        window.removeEventListener('resize', hide)
        bar.remove()
      }
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

      textFor = t
      if (sessions !== undefined) sessionsRef = sessions

      // The locale table is registered before anything resolves a label from it,
      // so no consumer can bind to the fallback copy.
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-side-chat: copy')

      ctx.effect(() => startSelectionBar(ctx, t), 'dsh-side-chat: selection bar')

      // A plugin reload must not leak the forks it is holding.
      ctx.effect(() => () => disposeAllChats(ctx), 'dsh-side-chat: dispose')

      // The page type. `commandId` is what makes the guide card render the
      // shortcut keys on its right edge.
      ctx.effect(
        () =>
          ctx.sidebarRightTabs.register({
            id: ID,
            kind: KIND,
            priority: 'extension',
            // One side chat per conversation. A stable address makes a second open
            // reveal the tab it already owns instead of stacking another copy, and
            // each conversation still gets its own because the Sidebar layout is
            // kept per session.
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

      // The composer overlay: floating entries rendered INSIDE the composer card.
      // A quote pill belongs to the composer the way an attachment does, not to
      // the strip above it, so it rides this slot and the card reserves its height.
      ctx.effect(
        () =>
          ctx.slots.inject(
            'conversation.input.overlay',
            () =>
              ctx.slots.register(
                { name: 'conversation.input.overlay', id: `${ID}.quotes`, order: 10 },
                QuoteDock,
              ),
          ),
        'dsh-side-chat: quote pill',
      )

      // Sent quote messages are plain text rows; this pass turns the label into the
      // pill. Throttled because the transcript mutates on every streamed token.
      ctx.effect(() => {
        if (typeof document === 'undefined' || document.body === null) return undefined
        if (typeof MutationObserver !== 'function') return undefined
        let timer
        const schedule = () => {
          if (timer !== undefined) return
          timer = setTimeout(() => {
            timer = undefined
            markQuoteMessages(document)
          }, 120)
        }
        markQuoteMessages(document)
        const observer = new MutationObserver(schedule)
        observer.observe(document.body, { childList: true, subtree: true })
        return () => {
          observer.disconnect()
          if (timer !== undefined) clearTimeout(timer)
        }
      }, 'dsh-side-chat: quote message pills')

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
