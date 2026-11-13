/**
 * 单价表与峰谷判定。
 *
 * 数据来源：DeepSeek 官方价目表（api-docs.deepseek.com/zh-cn/quick_start/pricing，
 * 抓取于 2026-11-13，对应 DeepSeek-V4.1-Flash-1017 / DeepSeek-V4-Pro-0813）：
 *
 *   deepseek-flash   缓存命中 ¥0.02/百万 · 缓存未命中 ¥1/百万 · 输出 ¥4/百万（谷时）
 *   deepseek-v4-pro  缓存命中 ¥0.15/百万 · 缓存未命中 ¥4.5/百万 · 输出 ¥13.5/百万（谷时）
 *
 * 高峰时段价格为谷时的 **2 倍**：北京时间周一至周五（不含中国法定节假日）
 * 9:00–12:00、14:00–18:00 为高峰；其余时段（含周末、法定节假日全天）为谷时。
 *
 * 这里给的 DEFAULT_RATES 是「谷时」基准价；高峰时乘 peakMultiplier。
 * 单价可以在 profile 的 cordis.patch.yml 里用本插件的 config.rates 覆盖，
 * 例如：{ "rates": { "deepseek-flash": { "cacheHit": 0.02, "cacheMiss": 1, "output": 4 } } }
 */

export const CURRENCY = 'CNY'

/** 谷时基准价：人民币 / 百万 tokens。cacheWrite 缺省按 cacheMiss 计（DeepSeek 不单收缓存写入费）。 */
export const DEFAULT_RATES = {
  'deepseek-flash': { cacheHit: 0.02, cacheMiss: 1, output: 4 },
  'deepseek-v4-pro': { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 },
}

export const PEAK_MULTIPLIER = 2

/** 网页搜索 / 抓取：¥5 / 1000 次成功请求（官方价格页，不分峰谷）。 */
export const SEARCH_CALL_PRICE = 0.005

export const DEFAULT_RATE_NOTE =
  '估算价目：deepseek-flash 谷时 ¥0.02/¥1/¥4（缓存命中/未命中/输出，每百万 tokens），deepseek-v4-pro ¥0.15/¥4.5/¥13.5；高峰翻倍；搜索/抓取 ¥5/千次'

/**
 * 把会话日志里五花八门的模型名归一到价目表的键上。
 * 例：DeepSeek-V4.1-Flash-1017 / deepseek-ai/DeepSeek-V4.1-Flash / deepseek/v4.1-flash → deepseek-flash
 *     tencent/Hy4-preview、gemini-4-argon… → 原文归一后返回（查不到价 → 只记 token，不计钱）
 */
export function normalizeModelKey(model) {
  let key = String(model == null ? '' : model).trim().toLowerCase()
  if (!key) return 'unknown'
  const slash = key.lastIndexOf('/')
  if (slash >= 0) key = key.slice(slash + 1)
  key = key.replace(/[.\s_]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  // 版本号尾巴：-1017 / -0813 / -v4 之类
  key = key.replace(/-\d{3,4}$/, '')
  if (key === 'flash' || key === 'deepseek-chat' || key === 'deepseek-reasoner') return 'deepseek-flash'
  if (/deepseek/.test(key) || /^v\d/.test(key)) {
    if (/flash|chat|reasoner/.test(key)) return 'deepseek-flash'
    if (/(^|-)pro($|-)/.test(key)) return 'deepseek-v4-pro'
  }
  return key
}

/** 北京时间（UTC+8）的某一天：YYYY-MM-DD。 */
function beijingDay(timeMs, offsetMinutes) {
  const d = new Date((Number(timeMs) || 0) + offsetMinutes * 60000)
  const pad = (v) => String(v).padStart(2, '0')
  return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate())
}

/**
 * 判断某条请求发生的时刻是高峰（peak）还是谷时（offpeak）。
 * options: { peakWindows: [[9,12],[14,18]], weekendOffPeak, offPeakDays, peakOverrideDays, timezoneOffsetMinutes }
 */
export function phaseAt(timeMs, options) {
  const opts = options || {}
  const offset = Number.isFinite(Number(opts.timezoneOffsetMinutes)) ? Number(opts.timezoneOffsetMinutes) : 480
  const d = new Date((Number(timeMs) || 0) + offset * 60000)
  const day = beijingDay(timeMs, offset)
  const offDays = opts.offPeakDays || []
  if (offDays.includes(day)) return 'offpeak'
  const peakDays = opts.peakOverrideDays || []
  if (peakDays.includes(day)) return 'peak'
  const weekday = d.getUTCDay() // 0 = 周日
  if (opts.weekendOffPeak !== false && (weekday === 0 || weekday === 6)) return 'offpeak'
  const windows = opts.peakWindows && opts.peakWindows.length ? opts.peakWindows : [[9, 12], [14, 18]]
  const hour = d.getUTCHours() + d.getUTCMinutes() / 60
  for (const window of windows) {
    const from = Number(window && window[0])
    const to = Number(window && window[1])
    if (Number.isFinite(from) && Number.isFinite(to) && hour >= from && hour < to) return 'peak'
  }
  return 'offpeak'
}

/**
 * 一条 usage 的金额（人民币）。buckets: { cacheMiss, cacheHit, cacheWrite, output }，单位 token。
 * rate 为谷时单价（元 / 百万 tokens）；phase 为 peak 时乘 multiplier。
 */
export function priceUsage(rate, phase, buckets, multiplier) {
  if (!rate || !buckets) return 0
  const peakMultiplier = Number.isFinite(Number(multiplier)) ? Number(multiplier) : PEAK_MULTIPLIER
  const miss = Number(buckets.cacheMiss) || 0
  const hit = Number(buckets.cacheHit) || 0
  const write = Number(buckets.cacheWrite) || 0
  const out = Number(buckets.output) || 0
  const missPrice = Number(rate.cacheMiss) || 0
  const hitPrice = Number(rate.cacheHit) || 0
  const writePrice = Number.isFinite(Number(rate.cacheWrite)) ? Number(rate.cacheWrite) : missPrice
  const outPrice = Number(rate.output) || 0
  const amount = (miss * missPrice + hit * hitPrice + write * writePrice + out * outPrice) / 1e6
  return phase === 'peak' ? amount * peakMultiplier : amount
}
