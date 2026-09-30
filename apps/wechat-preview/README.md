# 微信小游戏 Canvas 预览包

这是**可导入微信开发者工具的小游戏 Canvas 预览**：真实字库（NBA / 英雄联盟，各 68 字 × 2 = 136 张）、真实表情素材（74 张，来自电脑版）、真实规则（与 `packages/core` 同一份 `LocalTable` 适配器，构建时打包，不复制规则源码）。主产品仍是 `apps/client-cocos`，本包用于浏览器和微信模拟器里的早期验证。

## 微信开发者工具

当前本机使用已导入的根项目 `E:\dev\word-tiles-wechat` 打开；根目录 `project.config.json` 的 `miniprogramRoot` 指向生成目录 `../wechat-phone-preview`；修改此目录后先运行 `scripts/build-wechat-phone-preview.py`。打开根项目后点击“编译”即可进入小游戏运行时。此目录的 `project.config.json` 已与根项目使用同一个 AppID；若单独导入，请使用你可管理的小游戏 AppID。主菜单选字库 → 开始四人试玩 → 交接 → 摸牌/出句/表情造句 → 三席依次投票 → 评分 → 结算与下一局。

模拟器需要横屏设备。`index.html` 是浏览器预览入口，不参与微信导入。

主菜单新增“联机开发版 · 2–4 人房间”。它连接本机 `127.0.0.1:8787` 的开发服务端：每位玩家填写不同代号，房主创建房间并复制房间号，2–4 人准备后房主开局。联机画面只使用服务端发送给本玩家的 `view`，操作通过带 `command_id` 的 WebSocket 命令提交；断线恢复会重发同一个未确认命令。`network-client.js` 是此模式的 HTTP/WebSocket 客户端。服务端未启动时，仍可使用“开始四人试玩”体验完整单机流程。

在另一终端运行 `& ./scripts/server.ps1` 启动本地服务端。确认接口健康后，可用 `scripts/smoke-online.mjs` 做四个独立客户端的建房、开局、出句和投票联调；该脚本需要 Node 24+。

## 素材与生成文件

| 文件 | 来源 | 说明 |
|---|---|---|
| `content.js` | `scripts/build-preview-content.py` | 字库、表情清单、界面文案、主题色；浏览器/微信都能加载 |
| `core.bundle.js` | `scripts/build-preview-core.mjs` | 从 `packages/core`、`packages/content`、`packages/preview` 打包的规则与四席适配 |
| `assets/memes/` | 电脑版素材经 Pillow 转成 jpg/png | 74 张，单张最长边 640 |
| `assets/animations/` | `E:\总素材\gif素材` 按目录标题匹配，Pillow 抽帧生成 JPG 图集 | 59 张动画图集；静态封面仍从 `assets/memes/` 加载 |
| `assets/ui/` | 电脑版 SVG 经 Godot 光栅化为 png/jpg | 背景、牌面、牌背、头像、标记 |
| `../../assets/materials/` | 工程内保存的素材源文件 | 表情源图 + UI SVG + catalog.json，重建时读取这里 |

重新生成：

```powershell
# 素材与内容清单（需要本机 Python 3 + Pillow、Godot 4、E:\总素材\gif素材）
C:\Users\cyr\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe scripts\build-preview-content.py

# 规则包（Node 24）
node scripts/build-preview-core.mjs
```

只改界面代码时不用重建。`content.js` 与 `core.bundle.js` 是生成物，不要手改。

## 浏览器调试入口

```text
index.html            菜单
index.html?frame=table   直接进牌桌
index.html?frame=compose 牌桌 + 已选两张牌 + 表情面板
index.html?frame=memes   牌桌 + 已选三张表情
```

## 边界

- “开始四人试玩”是同一台设备四人轮流；“联机开发版”使用本地开发身份与本机服务端，尚未接微信正式登录。真机无法访问电脑的 `127.0.0.1`，正式联机还需部署服务端并配置可用的 HTTPS/WSS 地址。
- 联机模式已做房间、准备、个人视图、出句、投票、结算和命令重试的界面接线；本机四个 HTTP/WS 客户端的开局、私有视图、出句和三人投票已通过联调。微信开发者工具中的联机触控流程仍需在模拟器画面可捕获后验收。
- 浏览器和微信都可点按表情卡片或投票图片开始循环播放；松手后继续，点另一张时之前点过的动图也继续播放。同一页面内记住每张图的播放状态，共用一个更新计时器；离屏释放图集并停止重绘，滚回时重新加载续播，未点过的仍显示封面。后台暂停并释放资源，前台恢复该页面上所有已启动的动图；离开页面或内存告警时清理播放状态。图集从原 GIF 生成，单帧最长边最高 288 像素、最多 32 帧，目标采样 12 fps，长动画受帧数上限限制会低于该值；微信真机帧率仍待验收。
- 表情排序用面板里的左右箭头（拖动排序留给正式端）。
- 搜索在微信里调起系统键盘；浏览器用 `prompt`。
- 浏览器预览保留清晰动图；微信构建将动图拆成普通分包，主包控制在 4 MB 以下。实测体积见 `../../docs/PERFORMANCE_BUILD.json`；首次分包下载、内存及真机帧率仍需验证。
- 手机扫码预览使用单独生成的 `../wechat-phone-preview`：`scripts/build-wechat-phone-preview.py` 从本目录复制代码、74 张静态表情和 UI，将 59 张清晰动画图集原样复制到分包，避免 112 像素缩图和二次 JPEG 压缩。该目录有自己的 `project.config.json`，可作为小游戏工程直接导入；源预览目录仍保留较清晰的动画供浏览器查看。
