/**
 * 宿主半边的离线自检：用假 ctx 跑真实 apply()，验证计价与路由。
 * 运行：node test/host.test.mjs
 */
import { apply } from '../index.js'
import { phaseAt, priceUsage, normalizeModelKey, DEFAULT_RATES } from '../pricing.js'

let failures = 0
function check(name, actual, expected, tolerance) {
  const ok =
    typeof expected === 'number' && typeof tolerance === 'number'
      ? Math.abs(Number(actual) - expected) <= tolerance
      : JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) {
    failures += 1
    console.error('✗ ' + name + '\n    actual   = ' + JSON.stringify(actual) + '\n    expected = ' + JSON.stringify(expected))
  } else {
    console.log('✓ ' + name)
  }
}

// ── 计价单元测试 ────────────────────────────────────────────────────────
check('normalize deepseek-flash', normalizeModelKey('deepseek-flash'), 'deepseek-flash')
check('normalize V4.1-Flash-1017', normalizeModelKey('DeepSeek-V4.1-Flash-1017'), 'deepseek-flash')
check('normalize provider path', normalizeModelKey('deepseek-ai/DeepSeek-V4.1-Flash'), 'deepseek-flash')
check('normalize legacy v4-flash', normalizeModelKey('deepseek-v4-flash'), 'deepseek-flash')
check('normalize v4-pro', normalizeModelKey('DeepSeek-V4-Pro-0813'), 'deepseek-v4-pro')
check('normalize unknown', normalizeModelKey('tencent/Hy4-preview'), 'hy4-preview')

const options = { peakWindows: [[9, 12], [14, 18]], weekendOffPeak: true, timezoneOffsetMinutes: 480 }
// 北京时间周一 10:00 = UTC 周一 02:00 → 高峰
check('monday 10:00 Beijing is peak', phaseAt(Date.parse('2026-11-16T02:00:00Z'), options), 'peak')
check('monday 08:30 Beijing is offpeak', phaseAt(Date.parse('2026-11-16T00:30:00Z'), options), 'offpeak')
check('monday 12:30 Beijing is offpeak', phaseAt(Date.parse('2026-11-16T04:30:00Z'), options), 'offpeak')
check('monday 15:00 Beijing is peak', phaseAt(Date.parse('2026-11-16T07:00:00Z'), options), 'peak')
check('saturday 10:00 Beijing is offpeak', phaseAt(Date.parse('2026-11-21T02:00:00Z'), options), 'offpeak')
check('holiday override is offpeak', phaseAt(Date.parse('2026-11-16T02:00:00Z'), { ...options, offPeakDays: ['2026-11-16'] }), 'offpeak')

const flash = DEFAULT_RATES['deepseek-flash']
const buckets = { cacheMiss: 100, cacheHit: 900, cacheWrite: 0, output: 100 }
check('offpeak flash price', priceUsage(flash, 'offpeak', buckets, 2), 0.000518, 1e-12)
check('peak flash price doubles', priceUsage(flash, 'peak', buckets, 2), 0.001036, 1e-12)

// ── 路由 / 汇总 集成测试 ────────────────────────────────────────────────
const peakTime = Date.parse('2026-11-16T02:00:00Z')
const offpeakTime = Date.parse('2026-11-16T14:00:00Z')

function assistantEvent(seq, time, usage, model) {
  return {
    type: 'assistant/message',
    seq,
    time,
    data: {
      turn: 1,
      step: seq,
      message: { role: 'assistant', source: { kind: 'model', provider: 'deepseek-account', model: model || 'deepseek-flash' } },
      stream: [],
      usage,
    },
  }
}

const events = [
  { type: 'turn/start', seq: 0, time: peakTime, data: { turn: 1 } },
  assistantEvent(1, peakTime, { inputTokens: 1000, cacheReadTokens: 900, outputTokens: 100, totalTokens: 2000 }),
  assistantEvent(2, offpeakTime, { inputTokens: 1000, cacheReadTokens: 900, outputTokens: 100, totalTokens: 2000 }),
  assistantEvent(3, offpeakTime, { inputTokens: 500, outputTokens: 50, totalTokens: 550 }, 'claude-opus-5'),
  { type: 'tool/call', seq: 4, time: offpeakTime, data: { turn: 1, step: 3, callId: 'call-ok', name: 'web_search', arguments: '{"queries":["a"]}' } },
  { type: 'tool/call', seq: 5, time: offpeakTime, data: { turn: 1, step: 3, callId: 'call-bad', name: 'web_fetch', arguments: '{"url":"https://x"}' } },
  { type: 'tool/result', seq: 6, time: offpeakTime, data: { turn: 1, step: 3, message: { role: 'tool', toolCallId: 'call-bad', isError: true }, error: { name: 'Error', code: 'FETCH_FAILED' } } },
  { type: 'turn/end', seq: 7, time: offpeakTime, data: { turn: 1, reason: { kind: 'completed' } } },
]

const routes = new Map()
const cleanups = []
const session = {
  id: 'session-live',
  header: { version: 4, id: 'session-live', createdAt: peakTime, cwd: 'D:/work' },
  seq: 5,
  snapshotEvents: () => events,
}

const ctx = {
  sessions: { list: () => [session] },
  sessionPersistence: {
    list: async () => [],
    stat: async (id) => (id === 'session-live' ? { header: session.header, revision: 'r1' } : undefined),
    open: async () => {
      throw new Error('live session must not be read from persistence')
    },
  },
  webServer: {
    register: (route) => {
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    },
  },
  get: () => undefined,
  effect: (callback) => {
    cleanups.push(callback())
    return () => {}
  },
}

apply(ctx, {})

function call(pathname, query) {
  const route = routes.get(pathname)
  if (!route) throw new Error('route not registered: ' + pathname)
  const req = {
    method: 'GET',
    url: pathname + (query ? '?' + query : ''),
    headers: { host: '127.0.0.1:53708' },
  }
  let status = 0
  let body = ''
  const res = {
    statusCode: 0,
    setHeader() {},
    end(text) {
      status = this.statusCode
      body = text || ''
    },
  }
  return route.handler(req, res).then(() => ({ status, json: body ? JSON.parse(body) : null }))
}

check('routes registered', [...routes.keys()].sort(), ['/dsh-session-cost/api/session', '/dsh-session-cost/api/sessions'])

const summary = await call('/dsh-session-cost/api/sessions')
check('summary status', summary.status, 200)
check('summary ok', summary.json.ok, true)
check('one priced session', summary.json.sessions.length, 1)
// 峰时：(1000 miss×¥1 + 900 hit×¥0.02 + 100 out×¥4)/1e6 ×2 = 0.002836
// 谷时：(1000×¥1 + 900×¥0.02 + 100×¥4)/1e6      = 0.001418
// 搜索：1 次成功（失败的那次不计）× ¥0.005     = 0.005
check('session cost (peak + offpeak + search)', summary.json.sessions[0].cost, 0.009254, 1e-9)
check('session model cost only', summary.json.sessions[0].modelCost, 0.004254, 1e-9)
check('session search cost', summary.json.sessions[0].searchCost, 0.005, 1e-12)
check('session search calls (failed call excluded)', summary.json.sessions[0].searchCalls, 1)
check('session requests', summary.json.sessions[0].requests, 3)
check('session uncached input tokens', summary.json.sessions[0].tokens.input, 2500)
check('session cache read tokens', summary.json.sessions[0].tokens.cacheRead, 1800)
check('session output tokens', summary.json.sessions[0].tokens.output, 250)
check('session total tokens includes cache', summary.json.sessions[0].tokens.total, 4550)
check('totals equal session cost', summary.json.totals.cost, 0.009254, 1e-9)
check('totals search cost', summary.json.totals.searchCost, 0.005, 1e-12)
check('unpriced model is flagged', summary.json.sessions[0].unpricedModels, ['claude-opus-5'])
check('byModel has two models', summary.json.byModel.length, 2)
check('byModel model cost excludes search', summary.json.byModel.reduce((sum, row) => sum + row.cost, 0), 0.004254, 1e-9)

const single = await call('/dsh-session-cost/api/session', 'id=session-live')
check('single session status', single.status, 200)
check('single session cost', single.json.session.cost, 0.009254, 1e-9)
check('single session live', single.json.session.live, true)

const missing = await call('/dsh-session-cost/api/session', 'id=nope')
check('missing session is 500 with message', missing.status, 500)
check('missing session error text', /找不到这个会话/.test(missing.json.error), true)

// 清理：effect 的 disposer 被调用后路由应被移除（这里只验证 disposer 是函数）
check('host effect registered', typeof cleanups[0], 'function')

if (failures > 0) {
  console.error('\n' + failures + ' 项失败')
  process.exit(1)
}
console.log('\n全部通过')
