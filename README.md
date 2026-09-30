# 字有意思 · 微信小游戏重建

本工程按现有 Godot 项目的 `word-tiles-4` 规则重建微信端。目标：四人好友房、手机横屏、字牌造句、可选表情、三人投票、精确计分及多局累计。

当前是**可执行交接工程**，不是已完成或已上架的微信小游戏。实际完成情况以 `docs/STATUS.md` 和测试输出为准。

## 开始顺序

1. [给 GPT Sol 的执行指令](HANDOFF_TO_SOL.md)
2. [总体规划](docs/01_PRODUCT_PLAN.md)
3. [架构与技术栈](docs/02_ARCHITECTURE.md)
4. [规则与协议](docs/03_CONTRACTS.md)
5. [开发任务及验收](docs/04_IMPLEMENTATION_PLAN.md)
6. [客户端和资源设计](docs/05_CLIENT_AND_ASSETS.md)
7. [测试、运行和交付](docs/06_VERIFICATION.md)
8. [风险与待接入事项](docs/07_DECISIONS_AND_RISKS.md)

## 目录

- `packages/core/src`：无引擎、无网络、无系统时间的 TypeScript 规则代码。
- `packages/protocol/src`：客户端命令及网络 DTO。
- `packages/content/src`：素材搜索等纯函数。
- `tests`：Node 内建测试器；运行方式见下。
- `reference/godot`：2026-09-27 复制的旧项目代码/文档/目录配置，68 文件；不包含大图，不作为发布资源。
- `reference/manifest.json`：快照文件的 SHA-256，供核对参考基线。
- `apps/wechat-preview`：已可本地试玩的微信 Canvas 小游戏预览包。
- `apps/wechat-phone-preview`：独立微信小游戏扫码预览包，主包低于 4 MB；清晰动画通过分包按需加载，开启微信开发者工具代码压缩。
- `apps/client-cocos`：已写入 Cocos Creator 工程源码；编辑器导入和平台构建仍待验收。
- `apps/server`：本地四人房权威服务，HTTP 房间接口、WebSocket 玩家视图和 SQLite 恢复；范围见 `docs/M2_REPORT.md`。

## 本地四人联机

另开一个终端，在项目根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/server.ps1
```

服务默认监听 `127.0.0.1:8787`，仅在此脚本设置的 `LOCAL_MODE=1` 下接受 `POST /auth/local`。本地预览的 `Origin: null` 和 localhost 跨域请求会收到 CORS 许可。可设置 `WORD_TILES_DB` 指定 SQLite 文件；默认文件为 `apps/server/data/server.sqlite`，已被 `.gitignore` 忽略。客户端先取得 token、创建或加入房间并准备，再连接 `ws://127.0.0.1:8787/play` 发送 AUTH。具体请求和返回见 [M2 报告](docs/M2_REPORT.md)。`/auth/wechat` 尚未接入，不能用于公网部署。

根项目 `project.config.json` 的 `urlCheck: false` 仅供开发者工具连接本机服务；正式部署时应使用已配置的网络域名并恢复校验。

## 微信开发者工具本地查看

根项目默认指向优化后的 `apps/wechat-phone-preview`，也可单独导入该目录（类型为“小游戏”）。修改 `apps/wechat-preview/game.js` 后，运行 `python scripts/build-wechat-phone-preview.py` 同步构建，再点击“编译/预览”。首次启动只需要主包；长按表情时按需下载动图分包。主包预算 3.8 MB，每个动画分包预算 3.5 MB，总资源预算 19 MB；构建超预算会失败。具体大小见 [包体报告](docs/PERFORMANCE_BUILD.json)。[本轮性能与动图优化说明](docs/PERFORMANCE_OPTIMIZATION.md) 包含依据、验证和真机检查项。微信端同 Wi-Fi 联机使用手机房主，浏览器端使用本机 Node 服务。新分包版本尚未上传，历史二维码不包含这些改动。

2026-09-28 已用开发者工具的 `open-other --project E:\dev\word-tiles-wechat` 成功打开本项目根目录工程窗口。根目录的 `project.config.json` 原先通过 `miniprogramRoot` 指向 `apps/wechat-preview/`，现改为分包构建目录 `apps/wechat-phone-preview/`。此前单机版曾在模拟器进入“小游戏运行时”，调试器显示 0 个错误；本次新增联机版后，还未取得模拟器画面以确认编译结果。直接导入 `apps/wechat-preview` 会遇到 AppID 远端校验的 TLS 连接错误，因此使用根项目。

模拟器自动截图接口目前报 AppID 远端 TLS 错误；桌面画面捕获也超时，尚未完成新增联机界面的模拟器视觉与触摸验收。本地四客户端 HTTP/WS 联调、Canvas 触摸和规则测试均已通过，详情见 `docs/M2_REPORT.md` 与 `docs/PREVIEW_REPORT.md`。

原项目只读路径：`C:\Users\cyr\Documents\Codex\2026-09-18\1-2-2-3-4-1\outputs\word_tiles_m3_m4`。

## GitHub Pages 网页副本

本仓库配置 GitHub Actions 自动测试、生成网页副本并发布到 GitHub Pages，设置步骤见 [网页发布说明](docs/PUBLIC_WEB.md)。网页支持同一设备四人轮流试玩；跨设备联机需要另配后端。用户选择公开本仓库，因此整个源码和历史也会公开；Pages 部署产物仅包含网页运行文件。

## 测试

在项目根目录执行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/test.ps1
```

测试脚本优先使用 `WORD_TILES_NODE` 指定的 Node，其次使用本机 bundled Node 24，最后检查 PATH。需要 Node 24+，因为直接运行可擦除类型语法的 `.ts`；不依赖下载 npm 包。直接执行 `npm test` 也需要 PATH 中的 Node 24+。

Node 能执行 TS 不等于完成 TypeScript 静态类型检查。Cocos 构建、服务端构建、真机实测分别是独立验收项。

## 实施原则

复用玩法、契约、数据和测试依据；重建手机交互和平台接入。保留金色/墨绿牌桌气质，先完成一套字库及小型静态素材集，再逐步恢复动图。不得以浏览器或 Node 测试冒充微信真机可运行。
