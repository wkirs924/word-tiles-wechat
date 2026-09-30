# 2026-09-27 可见预览交付

2026-09-28 动图补充：`scripts/build-preview-content.py` 读取 `E:\总素材\gif素材`，按 catalog 标题匹配 74 张表情，识别出 59 张多帧源文件（包括无扩展名的 GIF），生成最长边 240 px、最多 48 帧的 JPG 图集及播放元数据。预览 Canvas 在鼠标悬停或触屏长按时按元数据裁切绘制当前帧，离开或松手恢复静态封面；触屏短按选择表情，长按只预览。预览目录约 14.2 MB，图集约 12.2 MB。`node --test tests/wechat-preview.test.mjs` 通过 6 项，`node scripts/run-tests.mjs` 全套 34 项通过；微信开发者工具模拟器因 AppID/TLS 启动故障尚不能验证画面和触屏手感。

## 本次可直接查看的画面

`apps/wechat-preview` 是独立的微信小游戏 Canvas 预览包，可导入微信开发者工具；它的 [菜单截图](../apps/wechat-preview/preview-menu.png) 和 [横屏牌桌截图](../apps/wechat-preview/preview-table.png) 已在 Chrome 无头模式从实际运行页面渲染。

2026-09-27 第二次更新：预览包不再使用占位表情和简化流程。74 张电脑版表情、8 个 UI 素材和 NBA/LOL 两套 136 张字库已复制进 `assets/materials`，由 `scripts/build-preview-content.py` 生成 `content.js`；规则核心由 `scripts/build-preview-core.mjs` 打包成 `core.bundle.js`，牌桌使用与 M1 相同的 `LocalTable` 适配器，覆盖摸牌、出句、表情搜索/排序、三人投票、0–3 评分、否决弃牌、结算与下一局。该包仍未连接 M2 联网服务，动图未接入。

正式方向的 `apps/client-cocos` 已写入 Cocos Creator 3.8 系列工程源文件：`assets/scenes/Table.scene` 含 Canvas、UI Camera 与 `TableBootstrap` 组件；`assets/scripts/TableBootstrap.ts` 以墨绿/金色程序化绘制四席、牌墙、本人手牌、投票进度和结算。点击座位先显示交接遮罩。出句、摸打、三票与多局使用 `packages/preview/src/local-table.ts` 连接 M1 `reduceSession`，失败不提前改变 UI 权威状态。`scripts/sync-cocos-core.ps1` 从唯一核心源和参考字库生成七个规则模块及 NBA/LOL 两套 136 牌数据，并写入 hash 清单。

## 验证

| 命令 | 实测结果 |
|---|---|
| `powershell -ExecutionPolicy Bypass -File scripts/sync-cocos-core.ps1` | 生成七个 core 模块及两套字库。 |
| `node scripts/generate-cocos-scene.mjs`（Node 24） | 生成入口场景和场景 meta。 |
| `node --check apps/client-cocos/assets/scripts/TableBootstrap.ts`（Node 24） | TypeScript 语法解析通过。 |
| `python scripts/build-preview-content.py` | 83 个素材文件复制到 `assets/materials`，8 个 SVG 光栅化，74 张表情转换，生成 `content.js`。 |
| `node scripts/build-preview-core.mjs` | 9 个规则模块打包为 `core.bundle.js`（约 39 KB）。 |
| `powershell -ExecutionPolicy Bypass -File scripts/test.ps1` | 25 项通过，0 失败；含 Cocos 场景/引用/hash 静态检查、本地四席 reducer 流程、生成素材/字库断言及微信 Canvas 触摸全流程测试。 |

本机常见安装路径、PATH 与卸载注册表未发现 Cocos Creator。因而 Cocos 场景**尚未经过编辑器导入、浏览器预览或微信构建**；静态检查不能代替该验收。当前无微信登录、好友房联网、SQLite 恢复或正式素材动画。

2026-09-28 微信开发者工具实测：已安装 Stable 2.02.2608070。先前导入的根项目因未指定源码目录报 `game.json` 缺失；在根目录 `project.config.json` 增加 `miniprogramRoot: "apps/wechat-preview/"` 并重启后，工具的可访问性状态显示“小程序运行时”已切换成“小游戏运行时”，模拟器包含 `myCanvas`；调试器显示 0 个错误、1 条基础库 HarmonyOS 通用提示。`get_simulator_console` 的 error 过滤结果为空。模拟器自动截图仍返回 `waitForAutomatorReady timeout`，故尚未取得微信模拟器截图，也未完成模拟器里的触摸全流程或真机验收。单独导入预览子目录在本机因 AppID 远端校验发生 TLS 连接错误；已导入的根项目可用来查看。

## 下一步最短路径

先在微信开发者工具打开已导入的根项目 `E:\dev\word-tiles-wechat` 查看本地预览，并手动操作一局，记录模拟器画面和触摸结果。安装/定位 Cocos Creator 3.8.x 后，按 `apps/client-cocos/README.md` 打开工程并在编辑器修正任何导入诊断，再预览 `Table.scene`。随后进入 M2：认证身份、房间队列、事务存储与四客户端联调；再将 Cocos 的 `LocalTable` 换成服务端视图传输。
