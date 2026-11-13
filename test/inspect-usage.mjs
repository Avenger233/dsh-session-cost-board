// 一次性诊断：解压会话日志（可能由多个 zstd 帧拼接），查看 assistant/message 的 usage 语义。
// 用法：node inspect-usage.mjs <日志文件> [条数]
import fs from 'node:fs'
import zlib from 'node:zlib'

const file = process.argv[2]
const limit = Number(process.argv[3] || 3)

function readAll(path) {
  return new Promise((resolve, reject) => {
    const chunks = []
    const stream = fs.createReadStream(path).pipe(zlib.createZstdDecompress())
    stream.on('data', (chunk) => chunks.push(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
  })
}

const text = await readAll(file)
const lines = text.split('\n').filter(Boolean)
console.log('records:', lines.length)
console.log('first record keys:', Object.keys(JSON.parse(lines[0])).join(','))

const usageStats = { total: 0, withCacheOverInput: 0, maxCacheRatio: 0 }
let shown = 0
let toolCalls = 0
for (const line of lines) {
  let rec
  try {
    rec = JSON.parse(line)
  } catch {
    continue
  }
  const ev = rec.event || rec
  if (ev.type === 'tool/call' && /web_(search|fetch)/.test(String(ev.data && ev.data.name))) toolCalls += 1
  if (ev.type !== 'assistant/message' || !ev.data || !ev.data.usage) continue
  const usage = ev.data.usage
  usageStats.total += 1
  if ((usage.cacheReadTokens || 0) > (usage.inputTokens || 0)) usageStats.withCacheOverInput += 1
  const ratio = usage.inputTokens ? (usage.cacheReadTokens || 0) / usage.inputTokens : 0
  if (ratio > usageStats.maxCacheRatio) usageStats.maxCacheRatio = ratio
  if (shown < limit) {
    console.log(
      JSON.stringify({
        seq: ev.seq,
        time: new Date(ev.time).toISOString(),
        provider: ev.data.message && ev.data.message.source && ev.data.message.source.provider,
        model: ev.data.message && ev.data.message.source && ev.data.message.source.model,
        usage,
      }),
    )
    shown += 1
  }
}
console.log('assistant/message with usage:', usageStats.total, 'cacheRead>input:', usageStats.withCacheOverInput, 'max ratio:', usageStats.maxCacheRatio.toFixed(2))
console.log('web_search/web_fetch tool calls:', toolCalls)
