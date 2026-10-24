# Breeze 插件：코사이트（韩漫聚合源）

给 [Breeze](https://github.com/deretame/Breeze) 漫画阅读器写的韩漫聚合插件，整合多个韩国漫画站。

- 仓库：<https://github.com/k623615746/Breeze-plugin-korsite>
- 版本：1.0.0

---

## 支持站点

| 站点 | 韩文 | 状态 |
| --- | --- | --- |
| 툰코 (Toonkor) | 툰코 | ✅ 已启用 |
| 펀비 (Funbe) | 펀비 | ✅ 已启用 |
| 뉴토끼 (Newtoki) | 뉴토끼 | ⚠️ Cloudflare 拦截，暂未启用 |

> 这些站共用同一套 Gnuboard 系统，结构完全一致，域名会不定期更换。
> 插件会自动从 [korsite.net](https://korsite.net/) 发布页获取最新域名并切换。

---

## 核心功能

- **中文检索**：输入中文关键词，自动翻译成韩文再搜索站内
- **域名自愈**：域名失效时自动从 korsite.net 发现新域名
- **分类浏览**：网页漫画 / 日漫 / 小说
- **完整阅读**：章节图片走各站 CDN，无需登录

---

## 安装

### 方式一：插件商店（推荐）

仓库名符合 Breeze 收录规范（`Breeze-plugin-` 前缀 + 公开仓库 + 根目录有 `manifest.json`），
客户端扫描 GitHub 后自动收录，可在 **发现页 → 插件 → 商店** 搜索「코사이트」安装。

### 方式二：本地安装

下载 [Releases](https://github.com/k623615746/Breeze-plugin-korsite/releases/latest) 里的
`breeze-plugin-korsite.bundle.cjs`，然后：
**发现页 → 插件 → 设置 → 插件管理 → 更新 → 从本地安装**。

### 方式三：网络安装

在「更新」对话框选「从网络安装」，填入：

```
https://github.com/k623615746/Breeze-plugin-korsite/releases/download/1.0.0/breeze-plugin-korsite.bundle.cjs
```

---

## 中文检索说明

韩漫站只能匹配韩文标题，插件内置了中文 → 韩文翻译（免费 MyMemory API）：

1. 输入中文关键词（如「独行玩家」）
2. 插件自动翻译成韩文（「솔로 플레이어」）
3. 用韩文搜索站内

如果关键词本身是韩文，则跳过翻译直接用原文搜索。

> MyMemory 匿名免费额度有限。可在插件设置里填入自己的邮箱（MyMemory 注册邮箱），
> 解锁更高翻译配额。

---

## 域名自动切换

这些站的域名换得很勤（`toonkor6.org`、`funbe683.com` 等带数字后缀）。
插件在请求失败时自动从 korsite.net 发布页抓取各站最新域名，探测可用后切换并持久化。

设置页底部提供「刷新各站域名」动作，可手动触发。

---

## 技术实现

```
src/
  common.ts     # 常量、实体解码、URL 归一化、列表条目构造
  sites.ts      # 站点清单 + 各站域名状态（零依赖）
  site.ts       # 从 korsite.net 发现各站最新域名
  http.ts       # fetch 封装：相对路径 + 韩文 URL 编码 + 域名自愈重试
  parse.ts      # Gnuboard HTML 解析：搜索 / 详情 / 章节图片
  translate.ts  # 中文 → 韩文翻译（MyMemory）
  get-info.ts   # 插件注册信息
  index.ts      # fnPath 实现
```

关键点：

- **章节图片是 base64 编码的 HTML 片段**：阅读页里 `toon_img = '<base64>'`，
  解 base64 后才是 `<img src>` 列表，图片在 `aws-cloud-no3.site` 等 CDN。
- **韩文 URL 必须编码**：QuickJS 的 fetch 不接受原始 Unicode 路径，
  请求前把路径逐段 `encodeURIComponent`。
- **搜索页混有论坛板块链接**（자유게시판/툰톡 等），需按导航清单过滤，
  作品链接特征为带连字符的韩文（`/S급-나무로-레벨업`）。
- **图片二进制透传**：`fetchImageBytes` 带 `x-rquickjs-host-offload-binary-v1: 1`。

---

## 构建与测试

```bash
npm install

# 类型检查
npx tsc --noEmit

# 生成 manifest + 打包 + Brotli
npx tsx build/generate-manifest.ts
npx rspack build
npx tsx build/generate-brotli.ts

# 离线解析回归（真实抓取页面）
npx tsx test/parse.test.ts    # 20 项

# 端到端（真实网络，含翻译/搜索/详情/图片）
npx tsx test/e2e.test.ts      # 6 项
```

---

## 已知限制

- **뉴토끼(newtoki)** 和 **블랙툰(blacktoon)** 有 Cloudflare 强校验，
  Node/QuickJS fetch 无法通过，暂未启用。
- 站点内容多为未经授权的搬运 / 汉化作品，版权归原作者及出版方所有。
  请自行判断使用合规性，建议支持正版。
- 中文 → 韩文翻译依赖 MyMemory，匿名额度有限；翻译失败时回退原文搜索。

---

## 声明

本项目仅为页面解析的技术实现，不存储、不缓存、不分发任何漫画内容，
所有图片均从原站实时获取。
