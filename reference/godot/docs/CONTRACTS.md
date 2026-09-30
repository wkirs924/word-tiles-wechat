# 公开接口与协议：word-tiles-4

本文替代旧的局末表情包协议。底层 JSON schema_version 为 1，规则版本为 word-tiles-4；v2 回放使用旧版本。

## 命令封套与身份

command_id、type、payload 必须提供；局内命令带 round_id，摸/打/出句带 turn_id，投票带 proposal_id。actor 由本地主机/未来认证网络连接绑定，不能放入客户端命令自报。session_reducer.reduce(previous, command, trusted_player_id) 返回 state、receipt、events、duplicate。

| 动作 | payload | 阶段/权限 |
|---|---|---|
| START_NEXT_ROUND | round_id、tiles、seed；或 wall 与 dice；可选 allow_extra_round | 主机，未开局或上一局终态 |
| DRAW_TILE | 空字典 | AWAIT_DRAW，行动者或主机 |
| DISCARD_TILE | tile_id | AWAIT_ACTION 或 MUST_DISCARD，行动者 |
| PROPOSE_SENTENCE | tile_ids；可选 reading_choices、resource_keys | AWAIT_ACTION，行动者 |
| SUBMIT_VOTE | approve 布尔、rating 整数 | AWAIT_VOTES，其他三人，默认 0–3 |
| END_GAME | 空字典 | 主机，任意非终态 |

PROPOSE_SENTENCE.resource_keys 省略等于 []；顺序有意义，不重复，最多 max_meme_images（默认 12）。每个 key 是非空标识字符串，最多 128 字符，不含 /、\、:。核心不读取资源文件、不检查关键词。tile_ids 必须是本人手牌且不重复，至少两张。reading_choices 各项 null 或仅含 tone 1–4。

SUBMIT_VOTE 必须同时包含认可选择与评分，没有默认分，不接受 bool 代替整数、不接受小数。收齐三份一次结算；失败不产生部分投票。旧 SUBMIT_MEME 和 SUBMIT_RATING 是 UNKNOWN_ACTION，终态统一 ROUND_TERMINAL。

## 数据模型

| 位置 | 字段 |
|---|---|
| round.pending | id、owner_id、tile_ids、characters、text、reading_choices、resource_keys、votes |
| pending.votes[player] | approve、rating；仅权威主机 |
| 已通过句子 | 提案元数据 + score（base/bonus/total 字数分）、approvals、rating_average（numerator/denominator=3）；无 votes |
| round.scores[player] | 累计字数分整数 |
| round.rating_bonus_thirds[player] | 各次通过句子评分之和，实际加分为该值 / 3 |
| result.scores[player] | sentence_points、remaining_tiles、rating_bonus（分数）、total（分数） |
| session.history | 局号/ID、结束原因、胡牌者、settled、本局分、确认字数分、confirmed_rating_bonus_thirds、句子、剩牌数、累计分子 |

total.numerator = 3 × (sentence_points − remaining_tiles) + rating_bonus_thirds。会话累加 total.numerator。展示可以格式化小数，排序必须用精确分子。

## 投影与事件

player_projection.view 只接受合法玩家身份。公开：自己的手牌、四家手牌数量和牌河、余墙数量、骰子、已通过句子、字数分与评分加分、当前公开提案、结果和排名。提案投影只含 resource_keys、文字/字符/读音、votes_received、has_voted 等公开信息；不带 votes、逐人分或实时平均分。

| 事件 | 可见数据 |
|---|---|
| ROUND_STARTED / HAND_DEALT / TURN_STARTED | 庄家/骰子、数量、行动者；发牌内容仅本人私有区 |
| TILE_DRAWN | 摸牌者/余墙数；牌面仅本人私有区 |
| TILE_DISCARDED | 公开单牌 |
| SENTENCE_PROPOSED | 提案元数据含有序图片，无 votes |
| VOTE_SUBMITTED | proposal_id、votes_received；表示认可选择与评分已原子提交 |
| SENTENCE_ACCEPTED | 完整公开通过句子，含 rating_average |
| SENTENCE_REJECTED | proposal_id、approvals、oppositions；无评分加分 |
| PLAYER_WON | player_id |
| SETTLEMENT_STARTED | reason、winner_id；不要求 UI 回复 |
| FINAL_SCORES | 全部本局分数 |
| SENTENCE_CANCELLED / ROUND_ABORTED | 被取消提案/结束信息 |
| ROUND_RECORDED | summary、ranking |

权威事件有 public/private 区，由投影转换成 id、revision、round_id、type、data。禁止直接向界面/网络发送权威事件。FINAL_SCORES 在胜利或流局命令中产生，不依赖图片播放完成。

## 公开应用接口

LocalHost.initialize / submit / reconnect / export_host_replay；submit 的多玩家 deliveries 仅宿主路由器使用，界面走 LocalTable。LocalTable.initialize / begin_handoff / confirm_handoff / current / submit / cover 保持原边界；交接立刻清除上一位投影与表现草稿。Session.export_replay / replay 仅用于可信完整记录。

同一身份同 command_id 同内容重发返回旧回执，无新事件/版本；同 ID 改内容拒绝。拒绝命令也记账。重连重新取得投影；不能由客户端恢复完整状态。

## 表现层接口

MemeSearch.rank(assets, query, glyphs) 返回带 match_count、matched_glyphs 的新数组，不修改输入。ContentStore.meme_assets(query, glyphs) 使用当前素材目录调用它。main 只从自己的投影手牌提取选中字；候选重排与 resource_keys 草稿顺序独立。关键词仅在素材目录中，网页能改；游戏提交不携带排序分。

ContentStore 只读访问器：text(key)、color(key)、texture(key)、tiles(preset_id)、font(role)、font_size()。`font` 角色固定为 options / vote / score / tile，缺省或空值回退到 `font.families` 默认链；字体与颜色均属表现层配置，不进入命令、事件或投影。


2026-09-25 v4：先判断、带图再评分。两步仅为本地表现流程；带图时最终仍用一个 SUBMIT_VOTE 原子提交。无图要求 rating=0，不受图片评分下界影响，非零返回 RATING_REQUIRES_MEME。v3 回放应使用旧 Git 版本，不静默按新规则解释。详见 [BALLOT_V4_HANDOFF.md](BALLOT_V4_HANDOFF.md)。
