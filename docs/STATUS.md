# 实际状态

2026-09-30 相册自定义表情与 Wi-Fi 房间共享：按用户选择，在四人试玩共用的表情选择界面加入“全部 / 我的表情 / 房间表情 / 添加表情”，相册原图导入、连续预览、名称与必填关键词、私有收藏删除；本机收藏在微信用户目录保存，浏览器四人试玩用 IndexedDB。新增 `gif-codec.js` 有界 GIF 解码与透明/局部更新/disposal/交错支持，`custom-memes.js` 负责 SHA-256 元数据/文件校验与存储，`lan-assets.js` 独立分块确认传输并串行读取文件。房主登记后共享目录进入 room 快照，新玩家/重连按目录补传；所有玩家收到所选自定义表情后才允许出句，投票/评分轮播自动播放当前自定义 GIF。限制单张 2 MiB、宽高 1024、GIF 30 秒/300 源帧；私有库 50 张/20 MiB，房间库 24 张/20 MiB，退出清理共享副本，私有收藏保留。规则核心、计分与内置表情资源未改。`AGENTS.md` 和 `docs/UI_CONVENTIONS.md` 记录授权与共用要求，使用/协议/待验收项见 `docs/CUSTOM_MEMES.md`。执行五份源 JS 的 bundled Node 24 `--check`、`git diff --check` 和 bundled Python `scripts/build-wechat-phone-preview.py`；主包 1,927,554 bytes，总包 18,299,553 bytes，5 个既有动画分包大小未变。未新增或运行自动测试，未做相册 GIF 原图保留、Android/iOS、双手机传输与动画真机验收，未上传新版。普通浏览器 Node HTTP/WS 房间没有自定义文件共享支持。

2026-09-30 四人试玩界面共用约定与动图/复制房间码修整：`AGENTS.md`、`docs/UI_CONVENTIONS.md` 明确今后的本地和联机游戏界面共用试玩版布局、组件、表情和 UI 资源，手机包由源码生成。`apps/wechat-preview/game.js` 的动图改为点按启动后持续循环、换图时切换，滑出可见区域暂停重绘，后台暂停/前台恢复；微信触控在松开时处理图片和复制按钮，滑动列表不误点。复制房间码改为浏览器同步复制优先，微信接口按 1.1 秒间隔串行调用、失败后限重试一次，旧房间的迟到请求不覆盖新房间码；大厅显示微信原始错误和当前房间号，失败时提供“手动取码”输入框供长按复制。用户此前报告的第二次建房复制失败仍待真机复验。`scripts/animation_assets.py` 从原 GIF 重新生成 59 组图集，最多 32 帧、目标 12 fps、最长边 288 像素、JPEG 质量 72，按 10 MiB 解码预算限制单图集；总帧数 1292→1754。执行 `scripts/build-preview-content.py --animations-only`、`scripts/build-wechat-phone-preview.py` 成功，手机包主包约 1.87 MB、总包约 18.24 MB，5 个动图分包均低于 3.5 MB；精确字节数见 `PERFORMANCE_BUILD.json`。未运行自动测试，未做微信真机播放或二次复制验收，未上传新版。

2026-09-29 动图交互与清晰度收尾：动图改为点按一次后持续循环播放（微信在手指抬起后继续循环，浏览器点击同样；切换到其他动图只保留当前图集，后台、内存告警或离开页面释放）。`scripts/animation_assets.py` 参数定为最高 288 像素、最多 32 帧、目标 12 fps、JPEG 质量 72，并按每张 10 MiB 解码预算自动降帧；重新生成 59 张源图集。手机包把动图拆为 5 个分包：主包 1,865,345 bytes（低于 4 MB 上传限制），分包 3.04–3.38 MB，总 18,237,344 bytes。新增浏览器点按循环与微信点按循环断言，更新表情网格、掷骰触点与联机开局步骤；bundled Node 24 全套 49/49 连续两次通过。未上传微信，未做真机帧率与分包下载验收。

2026-09-29 联机界面对齐四人试玩：联机房收到新一局视图后使用同一骰子动画显示权威点数与主家，轮次切换时只触发一次；表情造句共用试玩的字牌、搜索、图片网格、已选表情排序与提交面板，投票、评分、结算也共用试玩布局，保留联机命令与本人视图。复制房间号改从当前房间读取，重新进房清理旧提示，异步回调只更新当前客户端；浏览器剪贴板失败时尝试页面复制。修改 `apps/wechat-preview/game.js` 并重新生成 `apps/wechat-phone-preview/game.js`。执行 `scripts/build-wechat-phone-preview.py`，主包与分包体积见 `PERFORMANCE_BUILD.json`。未运行测试，未做微信真机或双机联机验收，未上传新体验版。

2026-09-29 性能与清晰动图优化：依据微信官方 GitHub 分包示例、API 类型库与 MDN Canvas 文档，实现按需 RAF 合并重绘、排序/单帧视图缓存、图片缓存软预算、后台暂停与内存告警释放。动图从原始 GIF 重建为最高 288 像素/帧、最多 32 帧、目标 12 fps，手机包原样复制避免二次 JPEG 压缩；通过普通分包按需加载，失败保留静图。主包约 1.87 MB（构建门槛 3.8 MB），5 个动图分包各低于 3.5 MB，总约 18.24 MB；详细实测见 PERFORMANCE_BUILD.json。启用开发工具代码压缩，根项目入口改指向生成手机包。新增构建、资源生命周期与分包行为检查，全套 Node 24 检查 49/49 通过。模拟 120 批各 8 次滚动事件：重绘 960→120 次，额外排序 960→0；这不是手机 FPS。查看过生成图集抽样首帧，未做本轮真机帧率/内存/微信分包上传验收，也未上传新二维码。步骤和资料链接见 PERFORMANCE_OPTIMIZATION.md。

2026-09-29 对手牌背微调：绿色内芯由四边各留 3px 扩大至 2px，黑色外框描边由 1.5px 缩至 1px，保留厚度与阴影；预览和手机包同步。bundled Node 24 --check apps/wechat-preview/game.js 通过，视觉待页面刷新验收。

2026-09-29 对手牌背配色：将浅色边框改为深黑色双层轮廓、保留绿色内芯并加深下缘阴影，预览与手机包 game.js 同步；bundled Node 24 --check apps/wechat-preview/game.js 通过。浏览器与真机视觉待刷新验收。

2026-09-29 用户纠正操作区位置：撤销上一版的左侧卡片与按钮搬移；左侧卡片恢复 x=180，句子入口恢复左下。操作按钮在右侧玩家卡片（x=928）正下方 y=462 横排，左边缘与卡片对齐，最多占 300px。预览与手机包同步；更新触摸坐标，bundled Node 24 相关检查 10/10 通过。

2026-09-29 操作按钮布局微调：本地与联机牌桌把操作按钮由右侧竖排改成左侧玩家卡片下方横排，起点同为 x=56；按钮按数量分配宽度并保持 10px 间距。将“大家认可的句子”入口移到右侧空位，避免与按钮重叠。同步 apps/wechat-phone-preview/game.js，更新触摸坐标；bundled Node 24 执行 node --test tests/wechat-preview.test.mjs tests/wechat-phone-preview.test.mjs，10/10 通过。浏览器及真机视觉尚未验收。

2026-09-29 根据用户手绘布局再次调整：中央桌面固定为 460×460，四边牌墙按剩余牌数分配；对手手牌独立于牌墙，左右玩家改为竖卡，对家信息移到右上，操作按钮放右侧，自己的信息与手牌留在底部。造句面板统一 16px 边框内缩、32px 内容内缩、16px 横向间隔，顶部字牌/表情数量/返回按钮同高对齐，修复已选字牌框挤占表情数量；搜索与三列图片网格同宽，提交按钮右对齐，最多 12 张已选表情分两行显示。同步手机包 game.js，更新触摸测试坐标。运行 bundled Node 24 `--test tests/wechat-preview.test.mjs tests/wechat-phone-preview.test.mjs`：9/9 通过；未做真机或浏览器目视验收，未上传微信。

2026-09-29 横屏手机牌桌重排：`apps/wechat-preview/game.js` 和手机包同名文件同步。中央桌面由 1208×444 收为 568×414，木质双层桌沿与内嵌绿绒面；以查看手牌的玩家为下方，三家按相对座次围桌，头像卡与牌背分区；对手牌背使用实际手牌数和等比例尺寸。下方自己的信息、手牌托盘、操作按钮分层；手牌加入厚度、抬起和编号。修复未初始化 trayWidth 的重复托盘绘制；本地造句/投票/结算弹窗隔离下层点击；微信布局按 safeArea 等比适配。更新 `tests/wechat-preview.test.mjs` 的触点和显示断言。运行 bundled Node 24 `--check apps/wechat-preview/game.js`、`--test tests/wechat-preview.test.mjs tests/wechat-phone-preview.test.mjs`，9/9 通过。未上传微信，未做浏览器或真机目视验收；已打开的 HTML 需刷新加载。

更新：2026-09-28，M1 完成；M2 本地联网纵切已运行；预览包接入电脑版素材与双字库；Cocos 工程源文件已落地。微信开发者工具已打开工程窗口，但当前模拟器启动失败。

2026-09-29 界面评审迭代（浏览器 `index.html?frame=online`、`frame=memes` 审核入口）：牌桌页眉删去"主家"标签；南家卡片移到牌墙右侧并与东家错开，四家卡片缩小到 160×68；字牌墙放大（顶排 24×36、两侧 22×33）并全部收进边框内、垂直居中；手牌行居中且托盘边框随牌数收缩；"大家认可的句子"改为胶囊按钮（小人图标＋右箭头），点开为可滚动句子面板（电脑滚轮、手机拖动、点外部关闭）；主菜单删去提示与字库标签并上移按钮；所有面板、按钮、座位卡圆角加大；表情选择改为每行 3 个、去掉图下标题与翻页，改为滚动（滚轮/拖动），删去"未选表情也可以直接出句"提示。`tests/wechat-preview.test.mjs` 增加句子面板开关断言并更新手牌与表情网格坐标；bundled Node 24 全套 44/44 通过。bundled Python 重建 `apps/wechat-phone-preview`（3,465,433 bytes），未上传；真机画面待验收。

2026-09-29 Wi-Fi 联机牌桌显示与正常模式对齐：Codex 未完的改动已修完。`onlineTableScreen` 复用本地牌桌的四席围桌布局（东/南/西/北按位摆放、牌背、中央牌墙、同一按钮行与手牌选中样式），新增 `onlineSeatOf` 把玩家 ID 映射回中文座位，修复行动/主家显示 undefined 的问题；页眉副标题和页脚改为与本地牌桌一致，结束本局按钮复用 `end_game` 文案与位置；`tests/wechat-preview.test.mjs` 增加主家、牌墙、操作行断言。使用 bundled Node 24 执行 `scripts/run-tests.mjs` 全套 44/44 通过；bundled Python 重新生成 `apps/wechat-phone-preview`，包体 3,459,013 bytes。已通过开发者工具 CLI 预览上传，TOTAL 3,498,312 bytes，二维码为 `phone-preview-qr-wifi-table.png`；随后以版本号 `1.0.4` 正式上传（2026-09-29 17:37，TOTAL 3,564,334 bytes，info 为 `phone-upload-1-0-4-info.json`）。真机扫码验收仍待做。

2026-09-29 真机反馈修复：扫码后房主建房曾报“当前微信版本缺少安全随机数接口”。`lan-client.js` 的房间密钥、重连令牌和开局种子现在先用 `wx.getRandomValues`，缺失或失败时用 `crypto.getRandomValues`，再退到 `Math.random` 与时间混合的局域网试玩兼容源；最后一级不具备密码学安全性，不用于开放网络身份验证。`tests/wechat-lan.test.mjs` 增加无微信随机接口的双模拟手机建房/加入测试，Node 24 全套 43/43 通过。重新构建手机包为 3,444,838 bytes；修复版已于 2026-09-29 15:24:53 通过开发者工具 CLI 预览上传，TOTAL 3,548,646 bytes，二维码为 `phone-preview-qr-wifi-random-fix.png`；用户正重新扫码，真机双机连接待验。

2026-09-29 手机房主同 Wi-Fi 试用链路：新增 `apps/wechat-preview/lan-client.js`，微信 Canvas 端的联机入口改用 `wx.createUDPSocket`；房主通过 `wx.getLocalIPAddress` 展示 `IP:端口/密钥`，客人手动输入加入。房主手机运行现有 `createSession/reduceSession/playerView` 规则，四席准备后开局，每位客人只收到自己的视图；UDP 传输按 <4096 bytes 分包，整包 ACK/重传，命令以 ID 去重，乱序快照按 revision 防回退。客人重连需要该手机保存的独立令牌；房主关闭小游戏后内存房间结束。浏览器仍使用原 Node HTTP/WS 本地联机客户端。`tests/wechat-lan.test.mjs` 用模拟四手机 UDP 验证入房、出句、三票结算、私有手牌，以及分包丢失重传、座位冒用拒绝；未在真实手机验证 Wi-Fi UDP 互通，也未实现房主退出后的牌局恢复。首版使用 bundled Python 执行 `scripts/build-wechat-phone-preview.py` 生成 `apps/wechat-phone-preview`，包体 3,444,006 bytes；使用 bundled Node 24 执行 `scripts/run-tests.mjs`，当时全套 42/42 通过。首版于 2026-09-29 15:20:32 通过开发者工具 CLI 预览上传，上传 TOTAL 3,547,676 bytes，二维码为 `phone-preview-qr.png`；其后随机数兼容修复及新上传记录见上段。

- [x] 选定重建路线和模块边界。
- [x] 保存 68 个旧项目参考文件及 hash 清单。
- [x] 总体/开发规划、协议、客户端资源方案、验收与风险说明。
- [x] bootstrap 测试：2026-09-27 初始运行 7 项通过，0 失败。
- [x] M1 单局规则、会话去重/多局/回放、玩家白名单投影和一条 Godot 实际运行对照；详见 `M1_REPORT.md`。
- [x] 预览内容管线：74 张电脑版表情、8 个 UI 素材、NBA/LOL 两套 136 张字库进入 `assets/materials`，由 `scripts/build-preview-content.py` 生成 `content.js`；`scripts/build-preview-core.mjs` 把规则核心打包给预览。
- [x] `apps/wechat-preview` 用真实素材与 `LocalTable` 规则重写完整流程（菜单/交接/摸牌/出句/表情搜索/投票/评分/结算/下一局），新增触摸流程测试与真实素材断言。
- [x] 预览包从 `E:\总素材\gif素材` 按表情标题生成 59 张逐帧 JPG 图集（约 12.2 MB）；浏览器鼠标悬停和微信触屏长按会播放当前图片，离开或松手恢复静态封面。已通过自动测试，微信模拟器画面仍受下述启动故障阻塞。
- [x] 2026-09-28 Canvas 预览界面修整：表情卡片去掉重复关键词行；造句页将已选字牌独立展示并调整搜索、选图和按钮间距；牌桌把上方座位、中央回合信息和右侧排名分开布局，消除截图中的交叠。浏览器 `file://` 自动化被安全审查拒绝，本次仅完成代码、坐标和自动测试复验，待用户刷新页面做目视验收。
- [x] 2026-09-28 本地试玩发牌随机化：`LocalTable` 原先每次新建都用首局固定种子 41，造成牌墙、骰子和西位庄家反复相同。现由预览适配层每局取新种子（可用时使用 `crypto.getRandomValues`，否则使用 `Math.random`），保留规则核心的种子回放能力；重建 `core.bundle.js`，增加注入种子测试覆盖连续轮次和重开牌桌。西位只是旧固定骰子的结果，新局庄家由随机骰子决定。微信模拟器实际画面仍待复验。
- [x] 2026-09-29 单局计分界面：本地四席头像旁实时显示已认可句子的字数分和表情评分，终局改显示扣除剩牌后的精确结算分；联机牌桌也加入四席头像与局内得分。移除牌桌中央重复且局中不更新的累计排名。结算页按**本局**精确得分排序，并列名次保留；下一局是可选重玩。新建本地桌和联机房 `planned_rounds=1`，核心默认与 Godot 对照仍为 4，以保留参考规则/回放测试。出句只更新分数，三票通过且手牌打空或牌墙耗尽时才终局结算；否决照旧强制弃牌。`scripts/build-preview-core.mjs` 已重建微信/浏览器共用规则包；测试含实时分、独立本局排名、联机可选下一局。微信模拟器实际画面尚待复验。
- [x] 2026-09-29 Cocos 示意牌桌同步：四席加入程序化圆形头像及头像旁的实时/结算分，终局中央按本局精确分排序；`scripts/sync-cocos-core.mjs` 同步新的随机发牌、单局配置到 `generated/LocalTable.ts`，增加生成适配器与源文件一致性检查。Cocos 编辑器实际导入与手机画面仍未验收。
- [x] 2026-09-29 微信/浏览器 Canvas 本地试玩开局展示掷骰动画：每次新游戏和下一局先显示两颗滚动骰，停下后明确展示该局权威骰子点数及 `dealer_id` 对应的主家，再自动进入交接。跳过动画会先展示真实结果，玩家可点“开始交接”；缺少完整定时器 API 时直接停在结果页等待点击。返回菜单、新开局和下一局会清理动画定时器。牌桌把“当前行动”、东南西北及主家移到标题栏，中央删去“第 N 局”和骰子小字，仅保留放大的牌墙数字与“牌墙剩余”。`apps/wechat-preview/game.js` 与 `tests/wechat-preview.test.mjs` 已更新；未改规则核心、随机种子或计分。
- [x] 2026-09-29 为手机扫码预览生成独立小包 `apps/wechat-phone-preview`：`scripts/build-wechat-phone-preview.py` 从现有 Canvas 预览复制相同游戏代码、双字库、74 张静态表情和 UI，并把 59 张动画图集重采样为最长边 112 像素、最多 20 帧。当前包体 3.26 MiB（小于 4 MB），保留长按动图功能；`tests/wechat-phone-preview.test.mjs` 校验所有资源、图集帧尺寸、代码同步和包体。这个包供微信开发者工具单独导入并点“预览”扫码，同机四人轮流可玩；真机启动及触摸画面尚待扫码验收，联网模式需可从手机访问的正式服务地址。
- [x] 微信开发者工具 2.02.2608070 已打开根项目；`miniprogramRoot` 指向预览包。先前曾观察到模拟器加载小游戏运行时 Canvas、调试器 0 错误；本次新增联机界面后，`open-other` 已成功打开工程窗口，但工具的模拟器截图接口报 TLS 错误，新增画面与触摸操作尚未验收。
- [ ] 2026-09-28 模拟器复验：工具窗口显示“模拟器启动失败 / Cannot convert undefined or null to object”。`open_project_window` 和 `simulator_screenshot` 均在 AppID 校验阶段返回 `APPID_ERROR`，底层是 TLS 连接在建立前断开。工具日志显示 `servicewechat.com` 请求失败、模拟器运行环境初始化后没有 `game.js` 执行记录。重新扫码登录、清除新进程代理环境变量、完整重启均未解决。Clash TUN 临时关闭时 `curl` 和 Node HTTPS 对同一微信接口返回 HTTP 200，但开发者工具仍失败；TUN 已恢复为原开启状态。暂不能把此错误归因于游戏代码，也不能宣称新界面已在微信模拟器验收。
- [ ] M2 本地权威服务：四席房间、HTTP/WS 联调、逐人投影、命令串行和 SQLite 重启恢复已实现；微信登录、生产安全、连续多局网络验收仍未完成。详见 `M2_REPORT.md`。
- [ ] M3 Cocos 客户端：已有 1280×720 入口场景、程序化四席牌桌和本地轮流适配器；Cocos 编辑器实际导入与手机预览尚未验收。
- [ ] M4 微信构建与真机验证。
- [ ] M5 正式 Cocos 客户端动图、真机性能与稳定性；Canvas 预览包动图已有本地实现。

可见预览：`apps/wechat-preview` 是原生微信 Canvas 小游戏预览包，已由 Chrome 无头模式实际渲染截图并运行触摸流程测试；本地四人联网入口已接入 M2 服务端协议，四客户端服务联调通过。新增联机画面还未在微信模拟器中完成视觉验收，它也不能替代 Cocos 最终构建。见 `PREVIEW_REPORT.md` 和 `M2_REPORT.md`。

此状态页区分本地规则完成与后续联网/手机平台验收。

## 已有代码

`json.ts`：JSON 安全边界、规范化、复制及安全字典。
`rules.ts`：完整规则配置、字数奖励及表情 key 校验。
`round.ts`：权威单局 reducer、发牌、摸打、提案、原子投票、胡/流局/中止与结算。
`session.ts`：身份绑定入口、命令去重与回执、多局累计/排名、完整可信回放。
`projection.ts`：玩家视图及分人事件白名单投影。
`scoring.ts`、`setup.ts`：M0 留下的默认玩法便捷函数；M1 权威开局和计分使用 `round.ts` + `rules.ts`，`session.ts` 复用 `scoring.ts` 的精确排名。M2 不应绕过会话入口调用便捷函数推进牌局。
`search.ts`：表情关键词筛选、不同选中字计数及稳定排序。
`commands.ts`、`validate.ts`：微信玩家意图 DTO 及运行时严格白名单校验。

`tests/m1.test.ts` 含固定 Godot 4.7.2 运行样本对照。`tests/wechat-preview.test.mjs` 校验生成素材/字库、规则包、逐帧动画、Canvas 触摸流程与本局独立排名。`tests/local-preview.test.ts` 还校验预览牌局使用每轮新种子和已认可句子实时加分。`tests/server-integration.test.ts` 与 `tests/server-security.test.ts` 校验四客户端闭环、协议边界、可选下一局和 SQLite 重启恢复。尚未证明所有历史 Godot 回放可直接导入；TypeScript 严格静态检查仍待实施。

2026-09-28 发牌随机化后，使用 Node 24 运行 `scripts/run-tests.mjs` 得到 35 项通过、0 失败。PATH 中的 Node 20 无法执行此测试入口；使用 `scripts/test.ps1` 或设置 `WORD_TILES_NODE`。

2026-09-29 单局计分界面修改后，用 Node 24 运行 `scripts/build-preview-core.mjs` 重建预览规则包、`scripts/sync-cocos-core.mjs` 同步 Cocos；`node --check apps/client-cocos/assets/scripts/TableBootstrap.ts` 与 `node --check apps/client-cocos/assets/scripts/generated/LocalTable.ts` 语法通过；`node --test tests/local-preview.test.ts tests/wechat-preview.test.mjs`、`node --test tests/server-integration.test.ts`、`node --test tests/cocos-project.test.mjs` 均通过；`scripts/run-tests.mjs` 全套 36 项通过、0 失败。未做微信模拟器、Cocos 编辑器和真机目视验收。

2026-09-29 掷骰开场和牌桌布局修改后，使用 Node 24 执行 `node --test tests/wechat-preview.test.mjs`，8 项通过、0 失败；执行 `node scripts/run-tests.mjs`，全套 37 项通过、0 失败。新增触摸行为测试用固定种子 47 验证 4+5 显示东位主家、下一局种子 42 验证 3+5 显示北位主家，并验证动画逐帧、跳过、无定时器回退、返回菜单和过期回调不会误入交接。未在微信模拟器或浏览器完成本轮目视验收。

2026-09-29 手机扫码包：使用本机 Python + Pillow 运行 `scripts/build-wechat-phone-preview.py`，输出 `apps/wechat-phone-preview` 约 3.42 MB，74 张静态表情、59 张压缩动画均在包内；基础库版本使用项目已配置的 `3.17.3`，修正源预览配置中 CLI 不接受的 `game` 占位。Node 24 运行 `scripts/run-tests.mjs` 全套 38 项通过、0 失败。随后在项目根目录执行 `& 'D:\微信web开发者工具\cli.bat' preview --project 'E:\dev\word-tiles-wechat\apps\wechat-phone-preview' --qr-format image --qr-output 'E:\dev\word-tiles-wechat\phone-preview-qr.png' --info-output 'E:\dev\word-tiles-wechat\phone-preview-info.json'`，工具返回 `√ preview`、上传 TOTAL 3,517,100 bytes，输出二维码 PNG 47,557 bytes。手机实际启动、触摸和动画仍待用户扫码验收。

2026-09-29 麻将牌背与重复牌排修正：预览与手机包 game.js 改为象牙白厚边、纯绿背板、倒角和底部阴影，移除中心短横；取消四边装饰牌墙，剩余牌只由中央计数显示。每位对手仅按 hand_counts 绘制一排，统一 22×32（侧面旋转为 32×22），以完整牌排宽度居中，较长手牌仅压缩间距。新增数量与对齐回归检查，覆盖 13 张以及 5/14/20 张不同手牌；bundled Node 24 --test tests/wechat-preview.test.mjs tests/wechat-phone-preview.test.mjs：10/10 通过。未做本轮浏览器或真机目视验收。
