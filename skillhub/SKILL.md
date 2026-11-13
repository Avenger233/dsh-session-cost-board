---
name: dsh-session-cost
slug: dsh-session-cost
displayName: DSH 会话花费
version: 1.0.2
summary: 统计每个 DeepSeek Harness 会话花了多少钱：设置页按会话列出金额与 token 明细，输入框下方还有当前会话的实时价格药丸。
description: 安装并说明 dsh-session-cost-board 插件（npm: dsh-session-cost-board，GitHub: Avenger233/dsh-session-cost-board）。按会话日志里的 usage 逐笔计价（DeepSeek 峰谷价、缓存命中/未命中/输出三个桶、搜索/抓取按次费），在「设置 → 会话花费」按会话列出花费，并在 composer 下方提供实时价格药丸。当用户问「这个会话花了多少钱 / 这几个会话哪个最贵 / 为什么这个月用了这么多」或想装一个按会话统计花费的 DSH 插件时使用。
license: MIT
homepage: https://github.com/Avenger233/dsh-session-cost-board
tags: [dsh, deepseek-harness, cost, tokens, billing, plugin, install]
---

# DSH 会话花费

在 DeepSeek Harness（DSH）里加一个「每个会话花了多少钱」的视图。这是插件 `dsh-session-cost-board` 的安装与使用技能；插件本身从 npm 或 GitHub 安装。

## 何时使用

- 用户问「这个会话 / 今天 / 这几个会话花了多少钱」「哪个会话最贵」；
- 用户想按会话看到 token 与金额明细、峰谷价差异、搜索/抓取费用；
- 用户要在 DSH 里装一个花费统计插件。

不适用：OpenClaw 的会话日志分析（那是另一套目录与格式）；官方账单对账（本插件是本地估算，见下）。

## 安装

要求 DSH `>= 0.2.2-rc.1 < 0.3.0`（插件 `engines.dsh` 已声明）。二选一：

```bash
# npm（推荐，可锁版本）
dsh plugin --profile <profile> add dsh-session-cost-board

# 或从 GitHub
dsh plugin --profile <profile> add github:Avenger233/dsh-session-cost-board
```

安装后插件会热加载；在「插件 → 已安装插件」能看到「会话花费」，并带图标与说明。若宿主无 HMR，重启 DSH 即可。

## 装完在哪看

1. **设置 → 会话花费**：全部会话按花费从高到低排；每行显示金额、请求数、未缓存输入 / 缓存命中率 / 输出 tokens、模型、时间；子会话（子代理）单独一行标「子会话」，进行中的标「进行中」。顶部是全部会话合计、按模型汇总、搜索/抓取费与「本次刷新耗时」。
2. **输入框下方价格药丸**：`● ¥x.xx` 表示当前会话到此刻的估算花费，鼠标悬停看 token 明细。它排在内置使用量统计（`N 轮 · tok/s · tokens`）之后。

## 计价口径（重要）

DSH 自己只记 token、不记钱；本插件按官方价目表折算：

- **三个计费桶**：未命中缓存输入（`inputTokens`，DSH 里这个字段就是未缓存部分）、缓存命中（`cacheReadTokens`）、输出（`outputTokens`）。缓存写入不单独收费，非 0 时按未命中价兜底；reasoning tokens 是 output 的子集，不另加。
- **逐笔峰谷**：每条请求按它自己的时间戳判定；DeepSeek 高峰为北京时间工作日 9:00–12:00、14:00–18:00，高峰价 = 谷时 × 2，其余时段/周末/法定节假日为谷时。
- **默认单价（谷时，人民币/百万 tokens）**：`deepseek-flash` 缓存命中 ¥0.02、未命中 ¥1、输出 ¥4；`deepseek-v4-pro` ¥0.15 / ¥4.5 / ¥13.5。
- **搜索/抓取**：`web_search`、`web_fetch` 的成功调用按 ¥5 / 千次折算（失败的不计）。
- **模型名归一**：`DeepSeek-V4.1-Flash-1017`、`deepseek-ai/DeepSeek-V4.1-Flash`、`deepseek/deepseek-v4.1-flash-1017`、`deepseek-chat`、`deepseek-reasoner` 等都归到 flash 价；认不出的模型只统计 token 并标「未定价」，不猜价。

## 自定义单价

改 profile 的 `cordis.patch.yml`，给 `session-cost` 行加 `config`：

```yaml
- id: session-cost
  name: dsh-session-cost-board
  config:
    rates:
      deepseek-flash: { cacheHit: 0.02, cacheMiss: 1, output: 4 }
      claude-opus-5: { cacheHit: 0.5, cacheMiss: 15, output: 75 }
    offPeakDays: ["2026-10-01"]   # 法定节假日按谷时
    searchCallPrice: 0.005
```

`rates` 里的模型名会归一后匹配。其余可调项：`peakMultiplier`、`peakWindows`、`weekendOffPeak`、`peakOverrideDays`、`maxSessions`、`showEmpty`、`listTtlMs`、`titleTtlMs`。

## 数据与隐私

- 只读本机会话日志（`sessionPersistence` + 内存中的会话），不联网、不上传、不写会话日志；
- 计价在本地完成，官方调价后需更新 `pricing.js` 或 `config.rates`；
- 金额是**估算**，不是账单；中转站模型按官方 DeepSeek 价估算，实际以中转站账单为准。

## 性能

页面每 20 秒自动刷新，但刷新是增量的：会话日志按持久层 revision 缓存、进行中的会话按日志 seq 缓存、会话目录缓存 30 秒、标题缓存 5 分钟；页面不可见时不轮询。实测 41 个会话 / 34 亿 tokens 规模下，冷启动首次约 1.4–5 秒，之后每次约 14 ms。界面底部会显示「本次刷新耗时 N ms」。

## 排查

| 现象 | 处理 |
|---|---|
| 设置里没有「会话花费」 | 确认插件已启用（插件 → 已安装插件）；重启 DSH；查看插件行是否有加载错误 |
| 药丸不出现 | 当前会话还没有带 usage 的 `assistant/message`（刚开始的新会话正常） |
| 金额为 0 且标「未定价」 | 模型不在价目表里：在 `config.rates` 补单价 |
| 金额偏低/偏高 | 检查是否为中转站模型、是否跨峰谷、是否漏了法定节假日 `offPeakDays` |

更多细节见插件仓库 README：<https://github.com/Avenger233/dsh-session-cost-board>
