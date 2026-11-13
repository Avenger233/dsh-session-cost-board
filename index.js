/**
 * dsh-session-cost-board —— 宿主半边
 *
 * 目标：回答「每个会话到底花了多少钱」。
 * 数据来源：会话日志里的 `assistant/message` 事件（每条自带 provider/model + usage）。
 *   · 当前打开的会话 → `ctx.sessions` 内存快照（不落盘也有）
 *   · 历史会话     → `ctx.sessionPersistence`（只读句柄）+ 会话查询服务（标题）
 * 计价：`pricing.js` 里的单价表（人民币 / 百万 tokens），按每条 usage 事件发生的时刻
 *   判断 DeepSeek 高峰 / 谷时，逐笔计价后累加——所以跨峰谷、跨调价的会话也能算对。
 *
 * 对外只暴露同源只读 HTTP 路由（客户端半边 fetch）：
 *   GET /dsh-session-cost/api/sessions        全部会话的花费列表
 *   GET /dsh-session-cost/api/session?id=...  单个会话（输入框下方的价格药丸用）
 */
import {
  CURRENCY,
  DEFAULT_RATES,
  normalizeModelKey,
  phaseAt,
  priceUsage,
  DEFAULT_RATE_NOTE,
  SEARCH_CALL_PRICE,
} from './pricing.js'

const ROUTE_BASE = '/dsh-session-cost/api'
const ROUTE_SESSIONS = ROUTE_BASE + '/sessions'
const ROUTE_SESSION = ROUTE_BASE + '/session'

/** 这些字段来自会话日志，是唯一真相；插件只做派生缓存。 */
const SUMMARY_TTL_MS = 4000
const MAX_SESSIONS = 400
const READ_CONCURRENCY = 6

export const inject = ['sessions', 'sessionPersistence', 'webServer']

export function apply(ctx, config) {
  const options = normalizeOptions(config)

  /** id -> { key, value }：只读会话日志的派生缓存，键含持久层 revision / 内存 seq。 */
  const sessionCache = new Map()
  /** id -> { title, at }：会话标题很少变，单独按 TTL 缓存。 */
  const titleCache = new Map()
  let memo = { at: 0, building: null, value: null }

  // ── 定价 ────────────────────────────────────────────────────────────────
  function rateFor(model) {
    const key = normalizeModelKey(model)
    for (const candidate of [key, key.replace(/-\d{3,4}$/, '')]) {
      const rate = options.rates.get(candidate)
      if (rate) return rate
    }
    // 宽松匹配：模型名里出现 flash / pro 家族词时退回家族默认价
    for (const [name, rate] of options.rates) {
      if (name.length >= 4 && key.includes(name)) return rate
    }
    return null
  }

  // ── 会话日志 ────────────────────────────────────────────────────────────
  async function readPersistedEvents(id) {
    const handle = await ctx.sessionPersistence.open(id, 'read')
    try {
      const result = await handle.read()
      return result.events
    } finally {
      try {
        await handle.close()
      } catch {}
    }
  }

  function foldEvents(events) {
    const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    const models = new Map()
    let modelCost = 0
    let requests = 0
    let searchCalls = 0
    let lastEventTime = 0
    const priced = new Set()
    const unpriced = new Set()

    // 搜索/抓取按“成功请求”计费：先收集失败的工具调用，避免把报错也算钱。
    const failedCalls = new Set()
    for (const event of events) {
      if (event.type !== 'tool/result') continue
      const data = event.data || {}
      const isError = Boolean(data.error) || Boolean(data.message && data.message.isError)
      const callId = data.message && data.message.toolCallId
      if (isError && callId) failedCalls.add(String(callId))
    }

    for (const event of events) {
      const time = Number(event.time) || 0
      if (time > lastEventTime) lastEventTime = time

      if (event.type === 'tool/call') {
        const data = event.data || {}
        const name = String(data.name || '')
        if ((name === 'web_search' || name === 'web_fetch') && !failedCalls.has(String(data.callId))) {
          searchCalls += 1
        }
        continue
      }

      if (event.type !== 'assistant/message') continue
      const usage = event.data && event.data.usage
      if (!usage) continue
      const source = (event.data && event.data.message && event.data.message.source) || {}
      const provider = String(source.provider || 'unknown')
      const model = String(source.model || 'unknown')

      // DeepSeek/Dsh 的 usage 语义：inputTokens 是**未命中缓存**的输入，
      // 缓存命中与缓存写入是独立桶，totalTokens 才是四者之和。
      const cacheMiss = Number(usage.inputTokens) || 0
      const cacheRead = Number(usage.cacheReadTokens) || 0
      const cacheWrite = Number(usage.cacheWriteTokens) || 0
      const output = Number(usage.outputTokens) || 0

      requests += 1
      tokens.input += cacheMiss
      tokens.output += output
      tokens.cacheRead += cacheRead
      tokens.cacheWrite += cacheWrite

      const rate = rateFor(model)
      const phase = phaseAt(time, options)
      const amount = rate
        ? priceUsage(rate, phase, { cacheMiss, cacheHit: cacheRead, cacheWrite, output }, options.peakMultiplier)
        : 0
      if (rate) priced.add(rate.label || normalizeModelKey(model))
      else unpriced.add(model)
      modelCost += amount

      const key = provider + '\u0000' + model
      let row = models.get(key)
      if (!row) {
        row = { provider, model, requests: 0, cost: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, priced: Boolean(rate) }
        models.set(key, row)
      }
      row.requests += 1
      row.cost += amount
      row.tokens.input += cacheMiss
      row.tokens.output += output
      row.tokens.cacheRead += cacheRead
      row.tokens.cacheWrite += cacheWrite
    }

    tokens.total = tokens.input + tokens.cacheRead + tokens.cacheWrite + tokens.output
    for (const row of models.values()) {
      row.tokens.total = row.tokens.input + row.tokens.cacheRead + row.tokens.cacheWrite + row.tokens.output
    }

    const searchCost = round6(searchCalls * options.searchCallPrice)
    return {
      cost: round6(modelCost + searchCost),
      modelCost: round6(modelCost),
      searchCost,
      searchCalls,
      requests,
      tokens,
      models: [...models.values()].sort((a, b) => b.cost - a.cost),
      lastEventTime,
      priced: priced.size > 0,
      unpricedModels: [...unpriced],
    }
  }

  async function summarize(entry, liveSession) {
    let events
    let cacheKey
    if (liveSession) {
      // 进行中的会话按「已落盘的日志位置」缓存：没有新事件就不重复折叠。
      cacheKey = 'live:' + liveSession.seq
    } else {
      cacheKey = 'rev:' + entry.revision
    }
    const cached = sessionCache.get(entry.id)
    if (cached && cached.key === cacheKey) return cached.value
    events = liveSession ? liveSession.snapshotEvents() : await readPersistedEvents(entry.id)
    const folded = foldEvents(events)
    const value = { ...folded, cacheKey }
    sessionCache.set(entry.id, { key: cacheKey, value })
    return value
  }

  async function collectEntries() {
    const liveMap = new Map()
    for (const session of ctx.sessions.list()) liveMap.set(String(session.id), session)

    const snapshots = await persistenceList()

    const entries = []
    const seen = new Set()
    for (const snapshot of snapshots) {
      const id = String(snapshot.header.id)
      seen.add(id)
      entries.push({ id, header: snapshot.header, revision: String(snapshot.revision) })
    }
    for (const [id, session] of liveMap) {
      if (!seen.has(id)) entries.push({ id, header: session.header, revision: 'live' })
    }
    entries.sort((a, b) => (Number(b.header.createdAt) || 0) - (Number(a.header.createdAt) || 0))
    return { entries, liveMap }
  }

  async function mapLimit(items, limit, worker) {
    const out = new Array(items.length)
    let next = 0
    const runners = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
      for (;;) {
        const index = next
        next += 1
        if (index >= items.length) return
        out[index] = await worker(items[index], index)
      }
    })
    await Promise.all(runners)
    return out
  }

  /**
   * 会话目录列表很贵（要扫全部工作区的会话目录），但 20 秒里几乎不会变；
   * 新建会话最多晚 `listTtlMs` 出现，进行中的会话不受影响（走内存快照）。
   */
  let listMemo = { at: 0, value: null }
  async function persistenceList() {
    const now = Date.now()
    if (listMemo.value && now - listMemo.at < options.listTtlMs) return listMemo.value
    try {
      const value = await ctx.sessionPersistence.list()
      listMemo = { at: now, value }
      return value
    } catch (err) {
      console.warn('[session-cost] 会话持久层列表失败：' + String(err && err.message ? err.message : err))
      return listMemo.value || []
    }
  }

  async function titlesFor(ids) {
    const now = Date.now()
    const result = new Map()
    const stale = []
    for (const id of ids) {
      const hit = titleCache.get(id)
      if (hit && now - hit.at < options.titleTtlMs) {
        if (hit.title) result.set(id, hit.title)
        continue
      }
      stale.push(id)
    }
    if (stale.length === 0) return result
    const query = ctx.get('sessionQuery')
    if (!query || typeof query.readTitleSnapshots !== 'function') return result
    try {
      const results = await query.readTitleSnapshots(stale)
      for (const item of results || []) {
        if (!item || item.status !== 'fulfilled' || !item.value) continue
        const id = String(item.sessionId)
        const title = item.value.title ? String(item.value.title.title || '') : ''
        titleCache.set(id, { title, at: now })
        if (title) result.set(id, title)
      }
    } catch {}
    return result
  }

  function entryView(entry, summary, title) {
    const header = entry.header || {}
    return {
      id: entry.id,
      title: title || null,
      createdAt: Number(header.createdAt) || null,
      cwd: header.cwd || null,
      parentSession: header.parentSession || null,
      origin: header.origin || null,
      live: Boolean(entry.live),
      cost: summary.cost,
      modelCost: summary.modelCost,
      searchCost: summary.searchCost,
      searchCalls: summary.searchCalls,
      requests: summary.requests,
      tokens: summary.tokens,
      models: summary.models,
      priced: summary.priced,
      unpricedModels: summary.unpricedModels,
      lastEventTime: summary.lastEventTime || null,
    }
  }

  async function buildSessionView(entry, liveMap) {
    const live = liveMap.get(entry.id)
    const summary = await summarize(entry, live)
    return entryView({ ...entry, live: Boolean(live) }, summary, null)
  }

  async function buildSummary() {
    const { entries, liveMap } = await collectEntries()
    const limited = entries.slice(0, options.maxSessions)
    const views = (
      await mapLimit(limited, READ_CONCURRENCY, async (entry) => {
        try {
          return await buildSessionView(entry, liveMap)
        } catch (err) {
          return {
            id: entry.id,
            title: null,
            createdAt: Number(entry.header && entry.header.createdAt) || null,
            cwd: (entry.header && entry.header.cwd) || null,
            live: liveMap.has(entry.id),
            error: String(err && err.message ? err.message : err),
            cost: 0,
            modelCost: 0,
            searchCost: 0,
            searchCalls: 0,
            requests: 0,
            tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            models: [],
            priced: false,
            unpricedModels: [],
          }
        }
      })
    )

    const visible = options.showEmpty ? views : views.filter((view) => view.requests > 0)
    const titles = await titlesFor(visible.map((view) => view.id))
    for (const view of visible) {
      const title = titles.get(view.id)
      if (title) view.title = title
    }

    const totals = {
      cost: 0,
      modelCost: 0,
      searchCost: 0,
      searchCalls: 0,
      requests: 0,
      tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      sessions: visible.length,
      sessionsTotal: views.length,
    }
    const byModel = new Map()
    for (const view of visible) {
      totals.cost += view.cost
      totals.modelCost += view.modelCost || 0
      totals.searchCost += view.searchCost || 0
      totals.searchCalls += view.searchCalls || 0
      totals.requests += view.requests
      addTokens(totals.tokens, view.tokens)
      for (const row of view.models) {
        const key = row.provider + '\u0000' + row.model
        let agg = byModel.get(key)
        if (!agg) {
          agg = { provider: row.provider, model: row.model, cost: 0, requests: 0, tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, priced: row.priced }
          byModel.set(key, agg)
        }
        agg.cost += row.cost
        agg.requests += row.requests
        addTokens(agg.tokens, row.tokens)
      }
    }
    totals.cost = round6(totals.cost)
    totals.modelCost = round6(totals.modelCost)
    totals.searchCost = round6(totals.searchCost)

    return {
      ok: true,
      currency: CURRENCY,
      generatedAt: Date.now(),
      rateNote: DEFAULT_RATE_NOTE,
      totals,
      byModel: [...byModel.values()].sort((a, b) => b.cost - a.cost),
      sessions: visible.sort((a, b) => b.cost - a.cost),
      truncated: entries.length > limited.length,
      sessionCount: entries.length,
    }
  }

  async function getSummary() {
    const now = Date.now()
    if (memo.value && now - memo.at < SUMMARY_TTL_MS) return memo.value
    if (memo.building) return memo.building
    memo.building = buildSummary()
      .then((value) => {
        memo = { at: Date.now(), building: null, value }
        return value
      })
      .catch((err) => {
        memo = { at: 0, building: null, value: null }
        throw err
      })
    return memo.building
  }

  async function getSession(rawId) {
    if (!rawId) throw new Error('缺少会话 id')
    const id = String(rawId)
    const live = ctx.sessions.list().find((session) => String(session.id) === id)

    let header
    let revision
    if (live) {
      header = live.header
      revision = 'live'
    } else {
      const stat = await ctx.sessionPersistence.stat(id)
      if (!stat) throw new Error('找不到这个会话：' + id)
      header = stat.header
      revision = String(stat.revision)
    }

    const entry = { id, header, revision }
    const summary = await summarize(entry, live)
    const view = entryView({ ...entry, live: Boolean(live) }, summary, null)
    const titles = await titlesFor([id])
    const title = titles.get(id)
    if (title) view.title = title
    return { ok: true, currency: CURRENCY, generatedAt: Date.now(), rateNote: DEFAULT_RATE_NOTE, session: view }
  }

  // ── HTTP 路由（同源，只读） ────────────────────────────────────────────
  function json(res, status, body) {
    const text = JSON.stringify(body)
    res.statusCode = status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(text)
  }

  function isLoopback(req) {
    const host = String((req.headers && req.headers.host) || '').toLowerCase()
    const name = host.split(':')[0]
    return name === '127.0.0.1' || name === 'localhost' || name === '[::1]' || name === '::1'
  }

  /** 信任栅栏：不可用时 fail-open（只读接口），能判定时按宿主结论拒绝。 */
  function blocked(req) {
    if (!isLoopback(req)) return 403
    try {
      const connection = ctx.get('connection')
      if (!connection || typeof connection.requestRejection !== 'function') return undefined
      const code = connection.requestRejection(req)
      if (code === undefined || code === null || code === false) return undefined
      return typeof code === 'number' ? code : 403
    } catch {
      return undefined
    }
  }

  const disposers = []

  function route(pathname, handler) {
    disposers.push(
      ctx.webServer.register({
        kind: 'exact',
        path: pathname,
        handler: async (req, res) => {
          const status = blocked(req)
          if (status !== undefined) {
            json(res, status, { ok: false, error: '只接受本机回环访问' })
            return
          }
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            json(res, 405, { ok: false, error: '只读接口' })
            return
          }
          try {
            await handler(req, res)
          } catch (err) {
            try {
              json(res, 500, { ok: false, error: String(err && err.message ? err.message : err) })
            } catch {}
          }
        },
      })
    )
  }

  route(ROUTE_SESSIONS, async (req, res) => {
    json(res, 200, await getSummary())
  })

  route(ROUTE_SESSION, async (req, res) => {
    const url = new URL(String(req.url || ''), 'http://127.0.0.1')
    json(res, 200, await getSession(url.searchParams.get('id')))
  })

  ctx.effect(() => () => {
    for (const dispose of disposers.splice(0)) {
      try {
        dispose()
      } catch {}
    }
    sessionCache.clear()
    titleCache.clear()
    listMemo = { at: 0, value: null }
    memo = { at: 0, building: null, value: null }
  }, 'session-cost: host resources')
}

// ── 小工具 ────────────────────────────────────────────────────────────────
function addTokens(target, source) {
  if (!source) return
  target.input += Number(source.input) || 0
  target.output += Number(source.output) || 0
  target.cacheRead += Number(source.cacheRead) || 0
  target.cacheWrite += Number(source.cacheWrite) || 0
  target.total += Number(source.total) || 0
}

function round6(value) {
  return Math.round((Number(value) || 0) * 1e6) / 1e6
}

function normalizeOptions(config) {
  const raw = config && typeof config === 'object' ? config : {}
  const rates = new Map()
  for (const [name, rate] of Object.entries(DEFAULT_RATES)) rates.set(normalizeModelKey(name), { ...rate, label: name })
  if (raw.rates && typeof raw.rates === 'object') {
    for (const [name, rate] of Object.entries(raw.rates)) {
      if (!rate || typeof rate !== 'object') continue
      const key = normalizeModelKey(name)
      const previous = rates.get(key) || {}
      rates.set(key, { ...previous, ...rate, label: name })
    }
  }
  return {
    rates,
    timezoneOffsetMinutes: Number.isFinite(Number(raw.timezoneOffsetMinutes)) ? Number(raw.timezoneOffsetMinutes) : 480,
    peakMultiplier: Number.isFinite(Number(raw.peakMultiplier)) ? Number(raw.peakMultiplier) : 2,
    peakWindows: Array.isArray(raw.peakWindows) && raw.peakWindows.length ? raw.peakWindows : [[9, 12], [14, 18]],
    weekendOffPeak: raw.weekendOffPeak !== false,
    offPeakDays: Array.isArray(raw.offPeakDays) ? raw.offPeakDays : [],
    peakOverrideDays: Array.isArray(raw.peakOverrideDays) ? raw.peakOverrideDays : [],
    maxSessions: Number.isFinite(Number(raw.maxSessions)) ? Math.max(1, Math.min(2000, Number(raw.maxSessions))) : MAX_SESSIONS,
    showEmpty: raw.showEmpty === true,
    searchCallPrice: Number.isFinite(Number(raw.searchCallPrice)) ? Math.max(0, Number(raw.searchCallPrice)) : SEARCH_CALL_PRICE,
    listTtlMs: Number.isFinite(Number(raw.listTtlMs)) ? Math.max(0, Number(raw.listTtlMs)) : 30000,
    titleTtlMs: Number.isFinite(Number(raw.titleTtlMs)) ? Math.max(0, Number(raw.titleTtlMs)) : 300000,
  }
}
