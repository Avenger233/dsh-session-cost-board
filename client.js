/**
 * dsh-session-cost-board —— 客户端半边
 *
 * 两个入口：
 *   1. 设置 → 会话花费：列出每个会话花了多少钱（按金额排序），带按模型汇总。
 *   2. 输入框下方（composer dock）的花费标签：当前这个会话到此刻花了多少。
 * 数据全部来自宿主半边的同源只读接口 `/dsh-session-cost/api/*`。
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-cost-board',
  factory(require) {
    const React = require('react')
    const { createElement: h, useCallback, useEffect, useRef, useState } = React

    const API = '/dsh-session-cost/api'
    const CSS_TAG = 'dsh-session-cost-board/style.css'
    const CSS = [
      '.sc-root{max-width:860px;color:var(--dsw-alias-label-primary);display:flex;flex-direction:column;gap:4px}',
      '.sc-title{margin:0;font-size:16px;font-weight:500;line-height:24px}',
      '.sc-intro{color:var(--dsw-alias-label-tertiary);margin:0 0 10px;font-size:13px;line-height:20px}',
      '.sc-cards{display:flex;flex-wrap:wrap;gap:10px;margin:2px 0 14px}',
      '.sc-card{min-width:132px;padding:10px 14px;border-radius:10px;background:rgba(127,127,127,.08);display:flex;flex-direction:column;gap:2px}',
      '.sc-card-v{font-size:19px;font-weight:600;line-height:26px;font-variant-numeric:tabular-nums}',
      '.sc-card-k{font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-tertiary)}',
      '.sc-group{margin:16px 0 6px;font-size:13px;font-weight:600;line-height:20px;display:flex;align-items:center;gap:8px}',
      '.sc-hint{font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-tertiary);font-weight:400}',
      '.sc-list{display:flex;flex-direction:column;border-top:.5px solid var(--dsw-alias-border-l2)}',
      '.sc-row{display:flex;align-items:flex-start;gap:12px;padding:9px 2px;border-bottom:.5px solid var(--dsw-alias-border-l2)}',
      '.sc-row:hover{background:rgba(127,127,127,.05)}',
      '.sc-row-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}',
      '.sc-row-name{font-size:13px;line-height:19px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
      '.sc-row-meta{font-size:11.5px;line-height:17px;color:var(--dsw-alias-label-tertiary);white-space:normal;word-break:break-word}',
      '.sc-row-right{display:flex;flex-direction:column;align-items:flex-end;gap:2px;flex:none}',
      '.sc-cost{font-size:13px;line-height:19px;font-weight:600;font-variant-numeric:tabular-nums}',
      '.sc-cost.sc-zero{color:var(--dsw-alias-label-tertiary);font-weight:400}',
      '.sc-badge{display:inline-block;font-size:10.5px;line-height:15px;padding:0 6px;border-radius:999px;background:rgba(127,127,127,.14);color:var(--dsw-alias-label-secondary);margin-left:6px;vertical-align:1px}',
      '.sc-warn{color:var(--dsw-alias-state-warning-primary,#b7791f)}',
      '.sc-actions{display:flex;align-items:center;gap:10px;margin-top:12px;padding-top:10px;border-top:.5px solid var(--dsw-alias-border-l2)}',
      '.sc-btn{background:transparent;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);border-radius:6px;font-size:12.5px;height:28px;padding:0 12px;cursor:pointer}',
      '.sc-btn:disabled{opacity:.5;cursor:default}',
      '.sc-err{color:var(--dsw-alias-state-error-primary);font-size:12px;line-height:18px;margin-top:8px;white-space:pre-line}',
      '.sc-pill{display:inline-flex;align-items:center;gap:4px;height:22px;padding:0 8px;border-radius:999px;font-size:11.5px;line-height:22px;color:var(--dsw-alias-label-secondary);background:rgba(127,127,127,.10);cursor:default;font-variant-numeric:tabular-nums}',
      '.sc-pill-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-brand-primary,#4d6bfe);opacity:.75}',
      '.sc-pill-close{display:inline-flex;align-items:center;justify-content:center;width:14px;height:14px;margin-left:2px;padding:0;border:none;border-radius:50%;background:transparent;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:14px;cursor:pointer;opacity:0;transition:opacity .12s}',
      '.sc-pill:hover .sc-pill-close{opacity:1}',
      '.sc-pill-close:hover{background:rgba(127,127,127,.22);color:var(--dsw-alias-label-primary)}',
      '.sc-toggle{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:10px 0;margin:2px 0 12px;border-top:.5px solid var(--dsw-alias-border-l2);border-bottom:.5px solid var(--dsw-alias-border-l2)}',
      '.sc-toggle-label{font-size:13px;line-height:19px}',
      '.sc-switch{position:relative;flex:none;width:36px;height:20px;padding:0;border:none;border-radius:999px;background:rgba(127,127,127,.30);cursor:pointer;transition:background .15s}',
      '.sc-switch.on{background:var(--dsw-alias-brand-primary,#4d6bfe)}',
      '.sc-switch-knob{position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#fff;transition:transform .15s}',
      '.sc-switch.on .sc-switch-knob{transform:translateX(16px)}',
      '.sc-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#4d6bfe);outline-offset:2px}',
    ].join('')

    function ensureStyle() {
      if (document.getElementById(CSS_TAG)) return () => {}
      const el = document.createElement('style')
      el.id = CSS_TAG
      el.textContent = CSS
      document.head.appendChild(el)
      return () => {
        const node = document.getElementById(CSS_TAG)
        if (node) node.remove()
      }
    }

    // ── 展示格式 ──────────────────────────────────────────────────────────
    function moneyText(value) {
      const n = Number(value) || 0
      if (n === 0) return '¥0'
      if (n < 0.001) return '¥' + n.toFixed(5)
      if (n < 0.01) return '¥' + n.toFixed(4)
      if (n < 1) return '¥' + n.toFixed(3)
      if (n < 1000) return '¥' + n.toFixed(2)
      return '¥' + n.toFixed(0)
    }

    function tokenText(value) {
      const n = Number(value) || 0
      if (n >= 1e8) return (n / 1e8).toFixed(2) + ' 亿'
      if (n >= 1e4) return (n / 1e4).toFixed(n >= 1e6 ? 0 : 1) + ' 万'
      return String(Math.round(n))
    }

    function amountText(value) {
      const n = Math.round(Number(value) || 0)
      if (n >= 1e4) return (n / 1e4).toFixed(1) + ' 万'
      return String(n)
    }

    function percentText(part, whole) {
      const w = Number(whole) || 0
      if (!w) return '0%'
      return ((Number(part) || 0) / w * 100).toFixed(1) + '%'
    }

    function cacheHitRate(tokens) {
      const read = Number(tokens && tokens.cacheRead) || 0
      const miss = Number(tokens && tokens.input) || 0
      return percentText(read, read + miss)
    }

    function searchText(row) {
      if (!row || !row.searchCalls) return ''
      return ' · 搜索/抓取 ' + amountText(row.searchCalls) + ' 次 ' + moneyText(row.searchCost)
    }

    function dateText(ms) {
      const n = Number(ms)
      if (!n) return ''
      const d = new Date(n)
      const pad = (v) => String(v).padStart(2, '0')
      return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
    }

    function sessionName(row) {
      if (row.title && String(row.title).trim()) return String(row.title).trim()
      return '会话 ' + String(row.id || '').slice(0, 8)
    }

    async function getJSON(path) {
      const response = await fetch(API + path, { headers: { accept: 'application/json' } })
      const body = await response.json().catch(() => ({}))
      if (!response.ok || body.ok === false) throw new Error(body.error || 'HTTP ' + response.status)
      return body
    }

    // ── 花费标签开关（设置页与标签共用，存本机 localStorage）─────────────
    const PILL_PREF_KEY = 'dsh-session-cost:pill-enabled'
    const pillPreference = (() => {
      let current = null
      const listeners = new Set()
      const read = () => {
        try {
          const raw = window.localStorage.getItem(PILL_PREF_KEY)
          return raw === null ? true : raw !== 'false'
        } catch {
          return true
        }
      }
      return {
        get() {
          if (current === null) current = read()
          return current
        },
        set(next) {
          current = Boolean(next)
          try {
            window.localStorage.setItem(PILL_PREF_KEY, current ? 'true' : 'false')
          } catch {}
          for (const listener of [...listeners]) {
            try {
              listener(current)
            } catch {}
          }
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => listeners.delete(listener)
        },
      }
    })()

    /** 订阅「是否显示花费标签」，设置页与标签本身实时同步。 */
    function usePillEnabled() {
      const [enabled, setEnabled] = useState(() => pillPreference.get())
      useEffect(() => pillPreference.subscribe(setEnabled), [])
      return enabled
    }

    // ── 设置页：会话花费 ──────────────────────────────────────────────────
    function SessionCostSection() {
      const [data, setData] = useState(null)
      const [error, setError] = useState('')
      const [loading, setLoading] = useState(true)
      const [tick, setTick] = useState(0)
      const [elapsedMs, setElapsedMs] = useState(null)
      const alive = useRef(true)
      const pillEnabled = usePillEnabled()

      const load = useCallback(async () => {
        setLoading(true)
        const startedAt = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
        try {
          const body = await getJSON('/sessions')
          if (!alive.current) return
          setData(body)
          setError('')
        } catch (err) {
          if (!alive.current) return
          setError(String((err && err.message) || err))
        } finally {
          if (alive.current) {
            const now = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now()
            setElapsedMs(Math.round(now - startedAt))
            setLoading(false)
          }
        }
      }, [])

      useEffect(() => {
        alive.current = true
        load()
        // 只在设置页可见时轮询：切到别的页面/最小化就完全不发请求。
        const timer = setInterval(() => {
          if (document.visibilityState === 'visible') load()
        }, 20000)
        const onVisible = () => {
          if (document.visibilityState === 'visible') load()
        }
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          alive.current = false
          clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [load, tick])

      const totals = (data && data.totals) || null
      const rows = (data && data.sessions) || []
      const byModel = (data && data.byModel) || []

      return h('div', { className: 'sc-root' },
        h('h3', { className: 'sc-title' }, '会话花费'),
        h('p', { className: 'sc-intro' },
          '把每个会话日志里的 token 用量，按单价表折算成金额。每条请求按它发生的时刻算高峰/谷时价，',
          '所以跨峰谷的会话也是逐笔累加的。数据是本地会话日志，不联网、不上传。'),

        h('div', { className: 'sc-toggle' },
          h('div', null,
            h('div', { className: 'sc-toggle-label' }, '在输入框下方显示本次会话花费'),
            h('div', { className: 'sc-hint' },
              pillEnabled
                ? '当前显示；关闭后输入框下方不再出现花费金额，随时可以在这里重新打开。'
                : '当前已关闭；打开后输入框下方会重新显示本次会话花费。')),
          h('button', {
            type: 'button',
            role: 'switch',
            'aria-checked': pillEnabled,
            className: 'sc-switch' + (pillEnabled ? ' on' : ''),
            title: pillEnabled ? '隐藏输入框下方的花费' : '显示输入框下方的花费',
            onClick: () => pillPreference.set(!pillEnabled),
          }, h('span', { className: 'sc-switch-knob' }))),

        error ? h('div', { className: 'sc-err' }, '读取失败：' + error) : null,

        totals
          ? h('div', { className: 'sc-cards' },
              h('div', { className: 'sc-card' },
                h('div', { className: 'sc-card-v' }, moneyText(totals.cost)),
                h('div', { className: 'sc-card-k' }, '全部会话估算花费')),
              h('div', { className: 'sc-card' },
                h('div', { className: 'sc-card-v' }, String(totals.sessions)),
                h('div', { className: 'sc-card-k' }, '有用量的会话')),
              h('div', { className: 'sc-card' },
                h('div', { className: 'sc-card-v' }, amountText(totals.requests)),
                h('div', { className: 'sc-card-k' }, '模型请求数')),
              h('div', { className: 'sc-card' },
                h('div', { className: 'sc-card-v' }, tokenText(totals.tokens.total)),
                h('div', { className: 'sc-card-k' }, '总 tokens（含缓存命中）')))
          : null,

        totals && totals.searchCalls
          ? h('div', { className: 'sc-hint', style: { marginTop: '-6px' } },
              '合计含搜索/抓取 ' + amountText(totals.searchCalls) + ' 次 ' + moneyText(totals.searchCost) + '（按 ¥5/千次估算）')
          : null,

        byModel.length
          ? h('div', null,
              h('div', { className: 'sc-group' }, '按模型'),
              h('div', { className: 'sc-list' },
                byModel.map((row) =>
                  h('div', { className: 'sc-row', key: row.provider + '/' + row.model },
                    h('div', { className: 'sc-row-main' },
                      h('div', { className: 'sc-row-name' }, row.model,
                        row.priced ? null : h('span', { className: 'sc-badge sc-warn' }, '未定价')),
                      h('div', { className: 'sc-row-meta' },
                        row.provider + ' · ' + amountText(row.requests) + ' 次请求 · 未缓存输入 ' + tokenText(row.tokens.input) +
                        ' · 缓存命中 ' + tokenText(row.tokens.cacheRead) +
                        ' · 输出 ' + tokenText(row.tokens.output))),
                    h('div', { className: 'sc-row-right' },
                      h('div', { className: 'sc-cost' + (row.cost > 0 ? '' : ' sc-zero') }, moneyText(row.cost)))))))
          : null,

        h('div', { className: 'sc-group' }, '按会话',
          h('span', { className: 'sc-hint' }, '按花费从高到低；点刷新重新统计（默认每 20 秒自动刷新）')),

        loading && !data
          ? h('div', { className: 'sc-hint' }, '统计中…（会话多时第一次会慢一点）')
          : rows.length === 0
            ? h('div', { className: 'sc-hint' }, '还没有可统计的会话。')
            : h('div', { className: 'sc-list' },
                rows.map((row) =>
                  h('div', { className: 'sc-row', key: row.id },
                    h('div', { className: 'sc-row-main' },
                      h('div', { className: 'sc-row-name' },
                        sessionName(row),
                        row.origin === 'subagent' || row.parentSession
                          ? h('span', { className: 'sc-badge' }, '子会话')
                          : null,
                        row.live ? h('span', { className: 'sc-badge' }, '进行中') : null,
                        !row.priced && row.requests > 0 ? h('span', { className: 'sc-badge sc-warn' }, '未定价') : null),
                      h('div', { className: 'sc-row-meta' },
                        dateText(row.createdAt) +
                        ' · ' + (row.models && row.models.length ? row.models.map((m) => m.model).join(' / ') : '—') +
                        ' · ' + amountText(row.requests) + ' 次请求 · 未缓存输入 ' + tokenText(row.tokens.input) +
                        ' · 缓存命中 ' + cacheHitRate(row.tokens) + ' · 输出 ' + tokenText(row.tokens.output) +
                        searchText(row))),
                    h('div', { className: 'sc-row-right' },
                      h('div', { className: 'sc-cost' + (row.cost > 0 ? '' : ' sc-zero') }, moneyText(row.cost)),
                      h('div', { className: 'sc-row-meta' }, tokenText(row.tokens.total) + ' tok'))))),

        data && data.truncated
          ? h('div', { className: 'sc-hint' }, '会话太多，只统计了最近 ' + rows.length + ' 个（共 ' + data.sessionCount + ' 个）。')
          : null,

        h('div', { className: 'sc-actions' },
          h('button', { className: 'sc-btn', onClick: () => setTick((v) => v + 1), disabled: loading },
            loading ? '统计中…' : '刷新'),
          h('span', { className: 'sc-hint' },
            data
              ? '更新于 ' + dateText(data.generatedAt) +
                (elapsedMs === null ? '' : ' · 本次刷新耗时 ' + elapsedMs + ' ms') +
                ' · ' + data.rateNote
              : '')),

        h('div', { className: 'sc-hint', style: { marginTop: '6px' } },
          '单价的默认值见插件 pricing.js；可在 profile 的 cordis.patch.yml 里给本插件加 config.rates 覆盖，',
          '例如 { "rates": { "deepseek-flash": { "cacheHit": 0.05, "cacheMiss": 0.5, "output": 1.5 } } }。'))
    }

    // ── 输入框下方：当前会话花费标签 ──────────────────────────────────────
    function CostPill(props) {
      const sessionId = props && props.sessionId ? String(props.sessionId) : ''
      const [row, setRow] = useState(null)
      const alive = useRef(true)
      const pillEnabled = usePillEnabled()

      useEffect(() => {
        alive.current = true
        if (!sessionId) return () => { alive.current = false }
        let cancelled = false
        const load = async () => {
          try {
            const body = await getJSON('/session?id=' + encodeURIComponent(sessionId))
            if (!cancelled && alive.current) setRow(body.session || null)
          } catch {
            if (!cancelled && alive.current) setRow(null)
          }
        }
        load()
        // 标签只在页面可见时轮询，后台不打扰宿主。
        const timer = setInterval(() => {
          if (document.visibilityState === 'visible') load()
        }, 10000)
        const onVisible = () => {
          if (document.visibilityState === 'visible') load()
        }
        document.addEventListener('visibilitychange', onVisible)
        return () => {
          cancelled = true
          alive.current = false
          clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisible)
        }
      }, [sessionId])

      if (!pillEnabled) return null
      if (!row || !row.requests) return null
      const tooltip = [
        '本次会话：' + moneyText(row.cost) + '（估算）',
        amountText(row.requests) + ' 次模型请求',
        '未缓存输入 ' + tokenText(row.tokens.input) + ' · 缓存命中 ' + tokenText(row.tokens.cacheRead) + ' · 输出 ' + tokenText(row.tokens.output),
        row.searchCalls ? '搜索/抓取 ' + row.searchCalls + ' 次（' + moneyText(row.searchCost) + '）' : '',
        row.priced ? '' : '包含未定价模型：' + (row.unpricedModels || []).join('、'),
      ].filter(Boolean).join('\n')

      return h('div', { className: 'sc-pill', title: tooltip },
        h('span', { className: 'sc-pill-dot' }),
        h('span', null, moneyText(row.cost)),
        h('button', {
          type: 'button',
          className: 'sc-pill-close',
          title: '隐藏输入框下方的花费（可在 设置 → 会话花费 重新打开）',
          'aria-label': '隐藏输入框下方的花费',
          onClick: (event) => {
            event.stopPropagation()
            pillPreference.set(false)
          },
        }, '×'))
    }

    const inject = ['slots']
    const NAMES = { nav: '会话花费', pill: '本次花费' }

    function apply(ctx) {
      ctx.effect(ensureStyle, 'session-cost: styles')
      ctx.effect(
        () =>
          ctx.slots.inject('settings.section', () =>
            ctx.slots.register(
              { name: 'settings.section', id: 'session-cost', order: 7, label: () => NAMES.nav },
              SessionCostSection,
            ),
          ),
        'session-cost: settings section',
      )
      ctx.effect(
        () =>
          ctx.slots.inject('conversation.composer.dock', () =>
            ctx.slots.register(
              { name: 'conversation.composer.dock', id: 'session-cost', order: 2, label: () => NAMES.pill },
              CostPill,
            ),
          ),
        'session-cost: composer pill',
      )
    }

    return { inject, apply, SessionCostSection, CostPill }
  },
})
