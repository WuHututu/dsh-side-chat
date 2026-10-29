/**
 * `dsh-side-chat` host half.
 *
 * A side chat is a Codex-style ephemeral fork on a host that has no `ephemeral`
 * flag: the agent is created inside a scope where `sessionPersistence` does not
 * resolve, so the lifecycle takes no session-log write handle and nothing is
 * written to `$DSH_HOME/sessions`. The session itself is published into the
 * SHARED `sessions` store, and the agent is adopted by the MAIN registry, so the
 * product's own conversation surface can drive it while it stays memory-only.
 *
 * The parent conversation's snapshot rides the agent's prompt section, not its
 * transcript: the model has the context, the panel opens empty.
 */
import { randomUUID } from 'node:crypto'

export const name = 'dsh-side-chat'

/**
 * Static dependencies. Cordis refuses property access to a service that is not
 * declared here, and `webServer` deliberately stays out of it: dynamic injection
 * keeps the plugin loadable on a headless host.
 */
export const inject = ['sessions', 'agentDefaultModel', 'tools']

/** Ceiling on inherited snapshot characters. */
const CONTEXT_BUDGET = 12000

/** The model-visible text of one content block. */
function textOf(block) {
  if (block === null || typeof block !== 'object') return ''
  return block.type === 'text' && typeof block.text === 'string' ? block.text : ''
}

/** Speaker of one projected message: projected nodes carry `source`, not `role`. */
function speakerOf(message) {
  if (typeof message.role === 'string') {
    if (message.role === 'assistant') return 'Assistant'
    if (message.role === 'system') return 'System'
    if (message.role === 'tool') return ''
    return 'User'
  }
  const kind = message.source?.kind
  if (kind === 'model') return 'Assistant'
  if (kind === 'tool' || kind === 'system-prompt' || kind === 'runtime-context') return ''
  return 'User'
}

/** Flatten one derived message into one `Role: text` line. */
function flattenMessage(message) {
  if (message === null || typeof message !== 'object') return ''
  const label = speakerOf(message)
  if (label === '') return ''
  const blocks = Array.isArray(message.content) ? message.content : []
  const text = blocks.map(textOf).filter((part) => part !== '').join('\n').trim()
  return text === '' ? '' : `${label}: ${text}`
}

/** The parent's tail, bounded, as reference only. */
function snapshotOf(session, budget) {
  if (session === undefined || budget <= 0) return ''
  let messages
  try {
    messages = session.deriveMessages()
  } catch {
    return ''
  }
  const lines = messages.map(flattenMessage).filter((line) => line !== '')
  const kept = []
  let used = 0
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (used + line.length > budget && kept.length > 0) break
    kept.push(line)
    used += line.length + 1
  }
  return kept.reverse().join('\n')
}

/** Prompt section text: narrowing rules plus the inherited snapshot. */
function briefingFor(snapshot) {
  const rules = [
    'You are in a side conversation, not the main thread.',
    'The material below is a read-only snapshot of the parent conversation, taken when this side chat opened. It is reference context, not your task.',
    'You cannot see turns the parent adds later, and nothing you say here is written back to it.',
    'Only what the user says after this point is an instruction.',
    'Keep answers short and direct unless the user asks for depth.',
  ].join(' ')
  return snapshot === '' ? rules : `${rules}\n\n<parent-snapshot>\n${snapshot}\n</parent-snapshot>`
}

/** One live side chat: the created agent plus the handle that adopted it. */
class SideChatEntry {
  constructor(agent, release) {
    this.agent = agent
    this.release = release
  }
}

export function apply(ctx) {
  /** Mounted lazily: the isolated stack is only needed once a chat opens. */
  let mounting

  const load = async (specifier) => {
    const loader = ctx.get('loader')
    const module = await loader.import(specifier)
    return module?.default ?? module
  }

  /**
   * The isolated stack.
   *
   * `sessionPersistence` is the ONE isolated name left unprovided: its absence is
   * what makes the session memory-only. Every other isolated name the loop
   * injects is re-provided, or its fiber waits forever for a dependency and never
   * registers a factory.
   */
  const ephemeralAgents = () => {
    if (mounting !== undefined) return mounting
    mounting = (async () => {
      const [AgentRegistry, AgentLoop, SystemPrompt] = await Promise.all([
        load('@deepseek-ai/dsh-agent'),
        load('@deepseek-ai/dsh-agent-loop'),
        load('@deepseek-ai/dsh-system-prompt'),
      ])
      const scope = ctx
        .isolate('sessionPersistence')
        .isolate('agents')
        .isolate('agentLoop')
        .isolate('systemPrompt')
      const prompt = scope.plugin(SystemPrompt, { includeHarnessIdentity: false, personaPrefix: '' })
      const registry = scope.plugin(AgentRegistry)
      const loop = scope.plugin(AgentLoop, { agents: [] })
      const errors = await Promise.all([
        prompt.await().then(() => undefined, (error) => error),
        registry.await().then(() => undefined, (error) => error),
        loop.await().then(() => undefined, (error) => error),
      ])
      await scope.fiber.await().catch(() => {})
      const agents = scope.get('agents')
      if (agents === undefined) {
        const detail = errors.map((error) => error?.message ?? 'ok').join(' | ')
        throw new Error(`the isolated agent stack did not mount (${detail})`)
      }
      // The fresh prompt is an empty registry: tool plugins register their
      // schemas on the root instance. Forward what the shared tools service
      // exposes so a side chat offers the real tool set.
      const isolatedPrompt = scope.get('systemPrompt')
      const sharedTools = ctx.get('tools')
      if (isolatedPrompt !== undefined && typeof sharedTools?.wireSchemas === 'function') {
        isolatedPrompt.tools((context) => sharedTools.wireSchemas(context.scope))
      }
      return agents
    })()
    return mounting
  }

  /** Live chats, keyed by session id. */
  const chats = new Map()

  const open = async (parentSessionId) => {
    const agents = await ephemeralAgents()
    const parent = ctx.sessions.get(parentSessionId)
    const snapshot = snapshotOf(parent, CONTEXT_BUDGET)
    const cwd = parent?.header?.cwd
    const selection = ctx.agentDefaultModel.currentSelection()
    const sessionId = `sidechat-${randomUUID()}`
    const handle = await agents.create({
      sessionId,
      // A side chat is a TOP-LEVEL session, not a subagent: `origin: 'subagent'`
      // (the only origin value the header accepts) marks it as delegated work and
      // the product's composer then locks itself read-only until it has read a
      // child session that does not exist. Lineage is carried by the prompt
      // section instead, which is all this needs.
      meta: {
        ...(cwd === undefined ? {} : { cwd }),
      },
      agentOptions: {
        provider: selection.provider,
        model: selection.model,
        ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }),
      },
      // The tools a conversation actually gets come from its AGENT PRESET:
      // `composeAgent` in the session controller mounts the preset's plugin rows
      // into the agent's own scope. Without a mount a side chat only sees the
      // handful of tools registered globally (working_directory and friends) —
      // no file access, no shell. So mount the same default preset the main
      // thread uses, then add the narrowing prompt section.
      async setup(agentCtx) {
        const presets = ctx.get('agentPresets')
        if (presets !== undefined && typeof presets.mount === 'function') {
          try {
            const resolved = await presets.resolve(undefined)
            await presets.mount(agentCtx, resolved.id)
          } catch (error) {
            ctx.logger?.warn?.(
              `side-chat: agent preset unavailable: ${error instanceof Error ? error.message : String(error)}`,
            )
          }
        }
        const text = briefingFor(snapshot)
        const applySection = (provider) => {
          provider.systemPrompt.section({ name: 'side-chat', text, order: 900 })
        }
        if (typeof agentCtx.inject === 'function') {
          agentCtx.inject(['systemPrompt'], (injected) => { applySection(injected) })
          return
        }
        try {
          applySection(agentCtx)
        } catch (error) {
          ctx.logger?.warn?.(`side-chat: prompt section unavailable: ${error instanceof Error ? error.message : String(error)}`)
        }
      },
    })
    // Adopt it into the MAIN registry so the product's conversation surface can
    // prompt and cancel it. The session-log writer was already skipped, so this
    // adds reachability without adding persistence.
    const mainAgents = ctx.get('agents')
    const release = mainAgents === undefined ? undefined : await Promise.resolve(mainAgents.register(handle.agent))
    chats.set(sessionId, new SideChatEntry(handle.agent, release))
    return { sessionId, inherited: snapshot.length }
  }

  const close = (sessionId) => {
    const entry = chats.get(sessionId)
    if (entry === undefined) return
    chats.delete(sessionId)
    try {
      entry.release?.()
    } catch {
      // Already torn down.
    }
  }

  const readJson = async (req) => {
    const chunks = []
    let total = 0
    for await (const chunk of req) {
      const buffer = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk
      total += buffer.length
      if (total > 64 * 1024) throw new Error('request body too large')
      chunks.push(buffer)
    }
    const bytes = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.length
    }
    return bytes.length === 0 ? {} : JSON.parse(new TextDecoder().decode(bytes))
  }

  const reply = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify(body))
  }

  const handler = async (req, res) => {
    const method = String(req.url ?? '').split('?')[0].slice('/side-chat/api'.length) || '/'
    try {
      const body = req.method === 'POST' ? await readJson(req) : {}
      if (method === '/open') {
        const parentSessionId = String(body.parentSessionId ?? '')
        if (parentSessionId === '') throw Object.assign(new Error('parentSessionId is required'), { statusCode: 400 })
        reply(res, 200, { ok: true, value: await open(parentSessionId) })
        return
      }
      if (method === '/close') {
        close(String(body.sessionId ?? ''))
        reply(res, 200, { ok: true, value: { closed: true } })
        return
      }
      reply(res, 404, { ok: false, error: { code: 'not-found' } })
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      ctx.logger?.warn?.(`side-chat: ${method} failed: ${detail}`)
      reply(res, error?.statusCode ?? 500, { ok: false, error: { code: 'error', message: detail } })
    }
  }

  // `webServer` is acquired through dynamic injection: a static `inject` would
  // refuse to activate the whole plugin on a headless host, and `ctx.get`
  // without the declaration resolves to undefined here.
  ctx.inject(['webServer'], (injected) => {
    const webServer = injected.get('webServer')
    if (typeof webServer?.register !== 'function') return undefined
    return webServer.register({ kind: 'prefix', path: '/side-chat/api', handler })
  })

  // A plugin reload must not leak memory-only sessions.
  ctx.effect(() => () => {
    for (const sessionId of [...chats.keys()]) close(sessionId)
    mounting = undefined
  }, 'dsh-side-chat: dispose')
}
