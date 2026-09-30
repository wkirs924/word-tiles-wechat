> 当前清理与模块拆分见 [2026-09-26 重构交接](PRESENTATION_REFACTOR.md)。下面保留各轮历史记录；其中旧版“保留预留 key”的策略已被本轮清理取代，不能当作当前接口。

# 清理与素材检查：word-tiles-3

本次清理仅在当前 M3/M4 工程内；旧版 Git/ZIP 保留用于回溯。

## 2026-09-26 小清理：长函数、文案与测试记录

- `ContentStore.valid_catalog` 保持公开签名和校验顺序，拆成 `_valid_ui`、`_valid_theme`、`_valid_font`、`_valid_assets`、`_valid_deck`；拒绝提示不变，新增一条坏字体角色字段仍被拒绝的断言。
- `BallotView.render` 保持签名，拆出 `_render_decision`、`_render_rating`、`_render_waiting`；节点、meta、文案、信号和显示顺序不变。
- 字库选项两处张数后缀复用已有 `tile_unit`，现有素材表下显示逐字不变；方位文字提为 `SEAT_COMPASS_TEXT` 常量。“当前自定义字库”前缀没有可复用的现有 key，按约束跳过其外置，不新增 key、不改校验规则。
- `MAHJONG_UI.md` 不再写死测试计数，改为引用 [最终实测记录](M3_M4_TEST_OUTPUT.txt)。每项独立提交，四组指定测试全绿才进入下一项；本轮无失败回退。core/application/projection、main.controller API 与 catalog 均未修改，未引入依赖或全文件格式化。

以下为此前清理记录。

已删除旧局末 _meme / _rate / eligible_meme_players 规则、SUBMIT_MEME / SUBMIT_RATING 动作实现、SETTLEMENT_MEMES / SETTLEMENT_RATINGS 阶段、旧选句下拉框和独立提交按钮、旧固定投票面板。评分与认可/反对统一在 SUBMIT_VOTE 中，避免两套状态机。

图片播放仍复用 meme_player.gd；搜索排序独立在 meme_search.gd，不放入规则 reducer。选图列表和已选数组分别处理，候选排序不污染已提交顺序。更新核心/投影/会话所需字段，移除旧 memes、ratings、rating_progress、meme_average 字段。

素材网页保留 8 个固定 UI key 和 28 个表情包；映射一致性测试通过，无孤立图片或缺失路径。每张表情必须有非空关键词，网页与游戏加载端都校验。keywords 可编辑，resource key 保持稳定。Godot 元数据在本地忽略，不进入 Git 归档。

最新结果（第一轮）：3461 次 Godot 检查、0 失败；13 组素材服务测试通过；9 张本次渲染截图成功。当前规则/架构/接口/README 已同步为 v3；历史 M1/M2 验收文档作为历史记录，不能据此恢复局末环节。

## 第二轮清理（2026-09-20，UI 简化与字体）

- 交互合并：删除「表情造句」和独立「提交句子」按钮；「弃一张」改名为「出牌」并覆盖弃一张/出句子两种行为；「摸一张」改名为「摸牌」。点手牌自动展开表情面板。
- 删除已无入口的旧实现：`main._meme_sequence`、`_render_meme_sequence()`、`move_meme()`、`table_action` 的 `MEMES`/`SENTENCE`/`DISCARD` 分支；面板里的 `sentence` 提交按钮。
- 表情卡片改为整体可点：点击选择/取消，金框 + `#n` 顺序号，`加入播放顺序`/`前移`/`后移`/`移除` 按钮从 UI 移除（对应 `ui.*` key 保留但归入编辑器「未使用 / 预留」分组）。
- 新增角色字体：`catalog.font` 支持 `families`/`size`/`roles`（options/vote/score/tile），游戏按角色覆盖；服务端、游戏端和编辑器三处同步校验。
- 表情面板加入 0.24 秒淡入/缩放/上滑过渡，只在首次展开播放；`tests/capture_preview.gd` 等待 0.35 秒后再截图。
- 同步更新：README、RULES、MAHJONG_UI、ASSET_GUIDE、M3_M4_ACCEPTANCE、新增 CONTENT_EDITOR.md；`tests/test_presentation.gd` 改为验证新交互。

最新结果（第二轮）：3502 次 Godot 检查、0 失败；15 组素材服务测试通过；9 张渲染截图成功。

后续打磨与人工验收详见 [INLINE_MEME_HANDOFF.md](INLINE_MEME_HANDOFF.md)。


2026-09-20 UI 修正：固定卡片/序号布局、图片尺寸、独立候选滚动和网页表情搜索；详见 [UI_POLISH_HANDOFF.md](UI_POLISH_HANDOFF.md)。
