# 性能、包体与动图清晰度优化

本轮针对现有微信 Canvas 小游戏/浏览器预览实现。Cocos 正式客户端和普通小程序 WXML 页面没有在本轮做平台迁移；生成目录仍然是 `compileType: game`。

## 结果与 4 MB 约束

- 原手机包约 3.47 MB，动图被压为最长边 112 像素、最多 20 帧、JPEG 质量 50。
- 新版主包约 1.87 MB，低于 4 MB；主包构建预算设置为 3.8 MB，留出余量。
- 清晰动图放在 5 个普通分包中，单包低于 3.5 MB。主包加全部动图约 18.24 MB。**这不是总包小于 4 MB 的方案**；启动只需主包，动图分包在点按表情时加载。
- 项目总包预算保守设为 19 MB。这是本工程的构建门槛，不替代微信后台/客户端版本的实际限制；尚未上传本轮产物。
- `docs/PERFORMANCE_BUILD.json` 为每次构建实测字节数，包括 README 等磁盘文件；开发者工具会忽略 README，并由 `setting.minified=true` 执行代码压缩。这里没有把 gzip 大小冒充上传包体。
- 根项目 `project.config.json` 指向 `apps/wechat-phone-preview/`，防止误把含全部高清动图的浏览器源码目录作为单一主包上传。

## 已实现

1. `game.js` 使用按需 requestAnimationFrame 合并同一帧内的滚动、图片加载及输入重绘；静止时不运行持续绘制循环。旧环境无该接口时同步绘制。
2. 表情排序按搜索词和所选文字缓存；单帧内只计算一次本地私有牌局视图；微信窗口尺寸在 resize/show 时更新。遮住牌桌的全屏造句/投票/评分面板不再先画一次隐藏牌桌。
3. 图片缓存使用最近访问顺序清理，预算为解码像素估算 24 MiB、最多约 40 个条目；当前帧必需图片受保护，故为缓存软预算，不代表整个游戏进程的峰值内存。切换活动动图释放前一张图集，收到内存告警或切后台释放图片引用与原生图片源。
4. 后台暂停动图、轮播、掷骰展示和房间轮询。恢复时重新加载当前画面；掷骰保留已经由规则确定的结果。对局期间不再重复轮询大厅，联机状态仍由原有 HTTP/WS/UDP 客户端负责。
5. 分包按需加载、同包请求去重；下载中仍显示静态封面，失败显示提示，8 秒后允许重新尝试；离开页面后迟到的加载回调不能重新持有已释放的图片。
6. `animation_assets.py` 直接从原 GIF 抽帧：最高 288 像素、最多 32 帧、JPEG 质量 72、保留彩色文字细节，并按每张图集 10 MiB 解码预算自动减少超标图集的帧数。按原总时长均匀采样，目标 12 fps，长动画因帧数上限会低于 12 fps；不把小源图强行放大。59 组图集总帧数由 1292 增至 1754，按总时长加权的采样率约 4.66→6.33 fps；这不是实机渲染帧率。
7. 手机构建直接复制已编码图集，消除原先的第二次有损 JPEG 压缩。每张图集最大估计解码占用 9,990,144 bytes；同一时间仅加载一张正在播放的动图。
8. 点按图片启动循环动画，松手后继续；点另一张切换活动图集。不可见时不重绘，重新可见时续播；后台暂停、前台恢复。
9. 表情静图/动图等比例完整放入卡片，不再为了填满宽卡片裁切并放大；开启图片平滑。原始 GIF 中已有的模糊、抖色与细节丢失无法凭重新编码恢复。

## 验证与局限

- 全量 Node 测试覆盖规则、联机、手机资产完整性、分包预算、动画图集尺寸及手机与源码代码同步。
- 新增行为检查：重绘合并、排序缓存、滚动后的图片回收、后台与迟到回调、按需分包与失败回退/重试、掷骰后台暂停。
- `scripts/benchmark-preview.mjs .tmp/game-before-optimization.js` 的 Node/VM 比较结果见 `PERFORMANCE_BENCHMARK.json`。120 批输入，每批 8 次滚动请求：绘制从 960 次降至 120 次，相同搜索的额外排序从 960 次降至 0 次。模拟 640×640 图片缓存从约 96.9 MiB 降至约 23.4 MiB。
- 上述数字是模拟环境中的调用和图片内存估算，**不是实际手机 FPS、GPU 耗时、启动时间或进程内存峰值**。
- 已查看 4 个生成动图首帧，未发现编码缺帧/黑图；这不替代真机播放检查。
- 待真机：开发者工具的分包上传验收、弱网首次加载/重试、连续滚动后内存曲线、后台恢复、iOS/Android 点按续播、清晰度与实际帧率。历史二维码仍是旧版。

## 重建

需要 Node 24+ 和 Python + Pillow。无需新增线上依赖或 CDN。

```powershell
# 只有原始动画素材/编码参数变化时才需要
python scripts/build-preview-content.py --animations-only
# 界面代码改完后也需运行此步
python scripts/build-wechat-phone-preview.py
node scripts/run-tests.mjs
# 可选：记录模拟输入负载，未传基线时只记录当前结果
node scripts/benchmark-preview.mjs
```

本机可用解释器见 `HANDOFF_TO_SOL.md`。输出包：`apps/wechat-phone-preview`；浏览器入口仍为 `apps/wechat-preview/index.html`。诊断：`GameGlobal.WordTilesPerformance.snapshot()`（浏览器为 `globalThis.WordTilesPerformance.snapshot()`），只有计数和资源估算，没有玩家内容。

构建器只移除上次生成清单里不再引用的资产，检查输出路径不能逃出生成目录；超预算直接报错，不偷偷降低图像质量。若需要**所有内容合计也低于 4 MB**，就需要进一步减少随包动图数量或另选远程资源方案，不能把当前分包总量称为 4 MB。

## 查阅依据

- [微信官方小游戏 GitHub 示例入口](https://github.com/wechat-miniprogram/minigame-demo/blob/master/miniprogram/game.js)：通过 `wx.loadSubpackage` 按需下载与处理失败。
- [微信官方示例 game.json](https://github.com/wechat-miniprogram/minigame-demo/blob/master/miniprogram/game.json)：`subpackages` 的 name/root 配置。
- [微信官方小游戏 API 类型库](https://github.com/wechat-miniprogram/minigame-api-typings/blob/master/types/wx/lib.wx.api.d.ts)：核对 `loadSubpackage`、`onHide/onShow`、`onMemoryWarning`。
- [MDN Canvas 优化指南](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Optimizing_canvas)：合并绘制、减少无用重绘及使用 requestAnimationFrame。

查阅日期：2026-09-29。微信开发文档网页直接访问失败，接口细节以微信官方维护的 GitHub 示例和类型声明交叉核对；未采用第三方 Unity 插件或纹理压缩方案，因为当前渲染路径为 Canvas 2D。
