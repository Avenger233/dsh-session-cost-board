# dsh-session-cost-board — 会话花费

**Per-session token & money accounting for DeepSeek Harness.** A settings page that ranks every conversation by what it cost (models, requests, cache hit rate, search/fetch fees), plus a live price pill under the composer.

给 DeepSeek Harness 加一个「每个会话花了多少钱」的视图。

- **设置 → 会话花费**：所有会话按花费从高到低排；每条显示金额、请求数、未缓存输入 / 缓存命中 / 输出 tokens、模型、时间，能识别子会话（子代理）与进行中的会话。顶部有全部会话合计与按模型汇总。
- **输入框下方的价格药丸**：当前这个会话到此刻花了多少（鼠标悬停看 token 明细）。

数据只来自本机会话日志（`sessionPersistence` + `sessionStore`），不联网、不上传；对日志只读。

## 安装

DSH 0.2.2-rc.1 及以上（`engines.dsh: >=0.2.2-rc.1 <0.3.0`）。

从本仓库安装：

```bash
dsh plugin --profile <profile> add github:Avenger233/dsh-session-cost-board
```

或本地目录安装（`link:` 绝对路径，开发时改代码即生效）：

```bash
git clone https://github.com/Avenger233/dsh-session-cost-board.git
dsh plugin --profile <profile> add "link:/absolute/path/to/dsh-session-cost-board"
```

装完页面会热加载；插件出现在「插件 → 已安装插件」，设置里多一页「会话花费」，输入框下方多一颗 `● ¥x.xx` 药丸。

## 计价口径

官方价目（抓取于 2026-11-13，[中文价格页](https://api-docs.deepseek.com/zh-cn/quick_start/pricing)）：

| 模型 | 缓存命中（谷/峰） | 缓存未命中（谷/峰） | 输出（谷/峰） |
|---|---|---|---|
| `deepseek-flash`（V4.1-Flash-1017） | ¥0.02 / ¥0.04 | ¥1 / ¥2 | ¥4 / ¥8 |
| `deepseek-v4-pro`（V4-Pro-0813） | ¥0.15 / ¥0.30 | ¥4.5 / ¥9 | ¥13.5 / ¥27 |

单位：人民币 / 百万 tokens。

- **峰谷**：北京时间周一至周五 09:00–12:00、14:00–18:00 为高峰（高峰价 = 谷时 × 2）；其余时段、周末、中国法定节假日全天为谷时。
- **逐笔计价**：每条 `assistant/message` 的 usage 按**它自己的时间戳**判断峰谷，所以跨 12:00、跨周末的会话也算得对。
- **计费桶**：未命中缓存输入（`inputTokens`，DSH 里这个字段就是未命中部分）、缓存命中（`cacheReadTokens`）、输出（`outputTokens`）。缓存写入不单独收费，非 0 时按未命中价兜底；reasoning tokens 是 output 的子集，不另加。
- **搜索 / 抓取**：`web_search`、`web_fetch` 的成功调用按 ¥5 / 1000 次折算（失败的不算），单独列在明细里。
- **模型名归一**：`DeepSeek-V4.1-Flash-1017`、`deepseek-ai/DeepSeek-V4.1-Flash`、`deepseek/deepseek-v4.1-flash-1017` 等都会归到 `deepseek-flash` 价；`deepseek-chat` / `deepseek-reasoner` 已下线、按 Flash 计。

## 配置（可选）

不改也能用。想覆盖默认值时，在 `~/.dsh/profiles/<profile>/cordis.patch.yml` 里给本插件的行加 `config`：

```yaml
- id: session-cost
  name: dsh-session-cost-board
  config:
    # 单价覆盖（元 / 百万 tokens，谷时基准；高峰自动 ×peakMultiplier）
    rates:
      deepseek-flash: { cacheHit: 0.02, cacheMiss: 1, output: 4 }
      deepseek-v4-pro: { cacheHit: 0.15, cacheMiss: 4.5, output: 13.5 }
      # 中转站 / 其它模型可以自己补：
      # DeepSeek-V4.1-Flash-1017: { cacheHit: 0.02, cacheMiss: 1, output: 4 }
      # claude-opus-5: { cacheHit: 0.5, cacheMiss: 15, output: 75 }
    peakMultiplier: 2          # 高峰价 = 谷时 × 这个倍数
    peakWindows: [[9, 12], [14, 18]]   # 北京时间的小时区间
    weekendOffPeak: true       # 周末全天谷时
    offPeakDays: []            # 法定节假日（YYYY-MM-DD）：这两天也按谷时
    peakOverrideDays: []       # 反过来强制按高峰
    searchCallPrice: 0.005     # 每次成功搜索/抓取（¥5/千次）
    maxSessions: 400           # 最多统计多少个会话（从新到旧）
    showEmpty: false           # true 时也列出没有任何用量的会话
    listTtlMs: 30000           # 会话目录列表缓存多久（新建会话最多晚这么久出现）
    titleTtlMs: 300000         # 会话标题缓存多久
```

`rates` 里的模型名会归一后再匹配，所以 `DeepSeek-V4.1-Flash-1017` 和 `deepseek-v4.1-flash` 是同一个键。

## 性能

「设置 → 会话花费」每 20 秒自动刷新一次，但刷新是**增量**的：

- 读过的会话日志按持久层 revision 缓存，没有新事件就不重读；
- 进行中的会话按内存里的日志位置（`seq`）缓存，没有新事件就不重复折叠；
- 会话目录列表缓存 30 秒、会话标题缓存 5 分钟；
- 页面切到后台 / 最小化时**完全不轮询**（`visibilitychange` 控制）。

本机实测（41 个有用量的会话、约 34 亿 tokens）：宿主重启后首次打开（冷缓存，要读全部日志）约 1.4–5 秒；之后每次 20 秒刷新 **约 14 毫秒**。界面底部显示「本次刷新耗时 N ms」，可以自己核对。

代价：新建的会话最多晚 30 秒出现在列表；标题最多晚 5 分钟变。

## 已知边界

- **是估算，不是账单**：会话日志只记 token，单价表是插件内置的（可覆盖）。官方调价后要更新 `pricing.js` 或 `config.rates`。
- **法定节假日默认按高峰算**（`offPeakDays` 为空时不会多算成谷时，宁可略偏高）；填上当年的节假日日期即可更准。
- **子会话单独一行**：subagent / fork 出来的会话有自己的会话 id，列表里会标「子会话」，不并进父会话；药丸只算当前会话本身。
- **未定价模型显示 ¥0 并标「未定价」**：中转站的模型（`gemini-4-argon`、`tencent/Hy4-preview`、`claude-opus-5` 等）没有官方价，按 token 只统计不猜价；补上 `config.rates` 就会计费。
- 中转站（洛樱 / 小老鼠 / 七牛）即使模型名是 DeepSeek，实际扣的是中转站自己的价，这里按官方 DeepSeek 价估算。

## 同类插件（网上已有的）

调研时找到的成熟方案，按「每个会话花了多少」这个目标排序：

1. `@dawn0608/dsh-session-cost`（1.2.2，声明支持 DSH ≥0.2.2-rc.1）：胶囊 + 明细，价格从官方页自动同步；不含子代理。
2. `dsh-cost-pill`（1.3.2，DSH ≥0.2.2-rc.1）：胶囊 + 余额 + 峰谷点，子代理并入本会话；费率随版本发布。
3. `dsh-cost-meter`（1.9.64）：预算、历史、多厂商额度，很重。
4. `@kidli1412/dsh-session-cost`、`dsh-plugin-session-spend`、`@shi-yangyang/dsh-token-dashboard` 等。

本插件选的是自建：数据口径贴 DSH 0.2.2 的 `tokenUsage` 投影语义（`inputTokens` = 未缓存输入）、逐笔峰谷、按模型归一、把子会话单独列出，并且不引第三方依赖。

## 结构

| 文件 | 作用 |
|---|---|
| `index.js` | 宿主：读会话日志、按 usage 计价、注册只读 HTTP 路由（`/dsh-session-cost/api/*`） |
| `pricing.js` | 单价表、模型名归一、峰谷判定、单条 usage 计价 |
| `client.js` | 客户端：设置页「会话花费」与输入框下方价格药丸 |
| `test/host.test.mjs` | 离线自检（假 ctx 跑真实 `apply()`，校验计价、token 桶、搜索费、路由） |

```bash
node test/host.test.mjs
```

## 界面示意（文字）

```text
设置 → 会话花费
┌──────────────────────────────────────────────────────────────┐
│ 会话花费                                                      │
│ 把每个会话日志里的 token 用量，按单价表折算成金额。              │
│                                                              │
│ ┌──────────┐ ┌────────┐ ┌────────┐ ┌──────────────────┐       │
│ │ ¥137.28  │ │ 41     │ │ 9660   │ │ 34.17 亿          │       │
│ │ 全部会话 │ │ 有用量 │ │ 模型请求│ │ 总 tokens（含缓存）│       │
│ └──────────┘ └────────┘ └────────┘ └──────────────────┘       │
│ 合计含搜索/抓取 140 次 ¥0.700（按 ¥5/千次估算）                 │
│                                                              │
│ 按模型                                                        │
│ deepseek-flash      deepseek-account · 9178 次请求 · …  ¥123.87│
│ DeepSeek-V4-Pro-0813 luoying-api · 189 次请求 · …       ¥10.63 │
│                                                              │
│ 按会话                                                        │
│ QQ                        [进行中]                     ¥47.38 │
│ 2026-10-25 11:03 · deepseek-flash · 3109 次请求 · 缓存 99.4%  │
└──────────────────────────────────────────────────────────────┘

输入框下方：
1 轮 157 步 · 219 tok/s · 36.5M tok · 缓存命中 99% · ● ¥1.37 · 29%
```

## License

MIT（见 [LICENSE](LICENSE)）。截图未随仓库发布，因为界面里含真实会话标题与账户信息。

[![](https://img.shields.io/badge/powered_by-dsh-4D6BFE?style=flat-square&logo=deepseek&logoColor=white)](https://github.com/deepseek-ai/deepseek-harness)
