> 历史设计记录。当前结构与接续入口见 [2026-09-26 重构交接](PRESENTATION_REFACTOR.md)，规则以 RULES.md 为准；不要照旧文件表把代码加回 main。

# 历史交接：回合内表情造句 v3

日期：2026-09-20。工程：`outputs/word_tiles_m3_m4`，分支 `m3-m4-playable`。旧局末多图基线为 `352f463`。

**开始前先读**：本文件 → [README](../README.md) → [RULES](RULES.md) → [CONTRACTS](CONTRACTS.md) → [ARCHITECTURE](ARCHITECTURE.md) → [CONTENT_EDITOR](CONTENT_EDITOR.md)（改素材工作台必读）。不要从旧 ZIP 或其他副本继续。

## 一句话现状

规则核心、投影、本地主机、素材工作台和本地试玩 UI 全部实现并有自动回归；当前 UI 已改为「点手牌自动展开表情面板 + 出牌一次提交」，支持按用途配置系统字体。剩余工作是真人鼠标验收、面板细节打磨、素材扩充，以及可选的联网/打包。

## 已完成（可信）

| 交付 | 位置 | 关键约束 |
|---|---|---|
| 有序图片随句提交 | `core/round_reducer.gd`、`core/rules.gd` | `PROPOSE_SENTENCE.resource_keys`；空数组合法，顺序保存，去重/上限/类型校验 |
| 投票与评分原子结算 | `core/round_reducer.gd` | `SUBMIT_VOTE` 同时带 approve、rating；三份收齐才结算 |
| 精确平均分、多句累计 | `core/round_reducer.gd`、`application/session_reducer.gd` | 整数字数分与 `rating_bonus_thirds` 分开，最终分母 3，无浮点累加 |
| 隐私/去重/重连/回放 | `projection/player_projection.gd`、`application/` | 逐人票/分隐藏；最终票重发不重复计分 |
| 搜索稳定排序 | `presentation/meme_search.gd` | 先搜索，再按不同选中字匹配数降序；同分保持目录顺序 |
| 牌桌 UI + 表情面板 | `presentation/main.gd`、`mahjong_table.gd`、`meme_player.gd` | 点手牌自动展开面板（0.24s 淡入/缩放/上滑过渡）；点图片选择/取消；「出牌」一次提交牌 + 图 |
| 角色字体 | `presentation/content_store.gd`、`main.gd`、`mahjong_table.gd` | `catalog.font.roles`：options / vote / score / tile，留空跟随默认链 |
| 素材工作台 | `tools/content_editor/` | 素材映射、表情包、界面文案（按游戏页面分组）、主题颜色、字体、试玩字库、指南；详见 [CONTENT_EDITOR](CONTENT_EDITOR.md) |
| 自动回归 | `tests/`、`scripts/test.ps1`、`scripts/test.ps1` 同类服务测试 | 见下文「验收命令」 |

## 当前 UI 行为（改界面前必须知道）

- 操作按钮只有三个：**摸牌 / 出牌 / 清空选择**。
  - 选 1 张点「出牌」= 弃一张（AWAIT_ACTION 或 MUST_DISCARD）。
  - 选 ≥2 张点「出牌」= 连同已选表情一次提交 `PROPOSE_SENTENCE`。
- **点手牌会立刻展开表情面板**（`main.select_tile()` 里设 `_meme_expanded = true`）。没有「表情造句」「提交句子」按钮了。
- 表情卡片整体可点，行为跟手牌一样：再点一次取消；选中显示金色边框和 `#n` 顺序号。顺序 = 点击顺序，取消再加入排末尾。
- 面板过渡动画只在“从关到开”时播放（`main._meme_panel_open` 记录状态），点其它手牌重绘不会反复闪入。
- 投票页仍然用 `meme_player.gd` 轮播，逻辑没变。

## 数据模型（`content/catalog.json`）

```json
{
  "schema_version": 1,
  "revision": 8,
  "title": "字有意思 · 素材工作台",
  "theme": { "background": "#172e31", "surface": "...", "paper": "...", "ink": "...", "accent": "...", "muted": "..." },
  "ui": { "title": "...", "... 79 个固定 key ...": "" },
  "assets": [ { "key": "...", "kind": "ui|meme", "path": "assets/...", "title": "...", "usage": "...", "size_hint": "...", "keywords": [], "license": "...", "notes": "..." } ],
  "deck": [ { "glyph": "字", "copies": 4 } ],
  "playback": { "seconds_per_image": 2 },
  "deck_presets": [ { "id": "nba.words", "title": "NBA", "deck": [] } ],
  "font": {
    "families": ["Microsoft YaHei", "Noto Sans CJK SC", "Arial"],
    "size": 18,
    "roles": { "options": "", "vote": "", "score": "", "tile": "" }
  }
}
```

硬约束（`tools/content_editor/server.py` 与 `presentation/content_store.gd` 双侧校验）：

- `ui` / `theme` 的 key 集合不能增删；`assets` 必须保留 8 个固定 `ui.*`（见 `content/ui_contract.json`）和至少一个 meme。
- 每个 meme 至少一个非空关键词；`deck` 总数必须正好 136。
- `playback.seconds_per_image` 0.25–30；`font.families` 1–8 项；`font.size` 12–48；`roles` 四个角色名固定，值可为空字符串。
- 顶层 key 集合必须与上一版一致（`deck_presets` 和 `font` 可缺省补默认）。
- 添加新顶层字段必须同时改 `server.py` 的 `validate_catalog`、`content_store.gd` 的 `valid_catalog`，否则存不进去或游戏拒载。

## 必须保持的接口

- `PROPOSE_SENTENCE.payload`：`tile_ids`、可选 `reading_choices`、`resource_keys`。
- `SUBMIT_VOTE.payload`：`approve` 布尔 + `rating` 整数 0–3；带当前 `proposal_id`。
- 结果：`sentence_points` 是字数分，`rating_bonus` 是累计平均分，`total` 是总分。
- `MemeSearch.rank(assets, query, glyphs)` 只接收数据；`content_store.meme_assets(query, glyphs)` 是 UI 入口。
- `ContentStore` 表现层入口：`text(key)`、`color(key)`、`font(role)`、`font_size()`、`texture(key)`、`tiles(preset)`、`meme_assets(query, glyphs)`。
- 交接清空上一位的选牌/选图/评分草稿；主机是唯一权威，UI 只控制临时选择和按钮。

规则边界（不要只改按钮）：通过 = 字数 + 字数奖励 + 三人评分平均分；无图也可评分；否决整手 0 分并强制弃一张；评分包含投反对者的分。字数奖励 2–3 字 +0，4–5 字 +1，6 字起 +3。

## 验收命令

```powershell
# 游戏全量回归（内部跑 tests/run_tests.gd，120 秒进程上限；必须 RESULT 0 failures、无 SCRIPT ERROR、退出 0）
powershell -ExecutionPolicy Bypass -File scripts/test.ps1

# 素材服务（当前 15 组）
python tools/content_editor/test_server.py

# 可选渲染检查（需要显示器，输出 .local/preview）
godot_console --path . --script res://tests/capture_preview.gd
```

修改布局后必须看 `.local/preview` 的新截图；自动截图不代表已完成真人鼠标验收。Git 归档命名带 GPT、INLINE-MEME 和提交号，不覆盖其他模型的副本。

## 接下来可做的简单工作（按顺序）

1. 用真实鼠标走完整流程：带图出句 → 三人交接评分 → 否决后弃牌 → 通过 → 胡牌/流局 → 主机结束 → 窗口 1000×700 → 重载素材。
2. 打磨表情面板：卡片网格滚动、选中卡片视觉（目前是金框 + `#n`，如需“抬起”效果可在 `HFlowContainer` 外用偏移实现）、搜索框聚焦体验。
3. 投票/结算面板的高度与滚动优化；保持“明确选分后才能提交”。
4. 扩充自有或获授权的图片与关键词；不改稳定 UI key，路径必须在 `assets/` 内。
5. 可选：上传字体文件（ttf/otf）作为打包方案；当前只支持系统字体名，若要上传需改 `server.py` 上传接口、`content_store.gd` 动态加载 `FontFile` 和编辑器字体页。
6. 可选：给「字体」页做字体预览（用 CSS 渲染示例文本）。

以上是打磨项，不要重搭架构、不要改计分协议、不要恢复局末表情环节。

## 复制给下一个模型的话

继续 `outputs/word_tiles_m3_m4` 的 word-tiles-3 回合内表情造句版本。先读 `docs/INLINE_MEME_HANDOFF.md`、`docs/CONTENT_EDITOR.md`、README、RULES、CONTRACTS、ARCHITECTURE。核心、投影、原子投票评分、精确累计、本地试玩 UI、角色字体和素材工作台都已实现并通过回归；UI 现状是「点手牌自动展开表情面板（带 0.24s 过渡）、点图片选择/取消、出牌一次提交牌和图」。只做打磨与人工验收：不重搭架构、不改计分协议、不恢复局末表情包、不删除固定 UI key。完成后跑 `scripts/test.ps1` 与 `python tools/content_editor/test_server.py`，查看 `.local/preview` 截图，并更新文档。
