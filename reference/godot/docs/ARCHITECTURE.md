# 架构：回合内表情造句 v4

规则依据 [RULES.md](RULES.md)，接口依据 [CONTRACTS.md](CONTRACTS.md)。素材工作台结构与扩展方式见 [CONTENT_EDITOR.md](CONTENT_EDITOR.md)。当前模块接口、迁移阶段和接续说明见 [PRESENTATION_REFACTOR.md](PRESENTATION_REFACTOR.md)。

## 模块与数据流

状态 → 玩家投影 → 表现；选牌/选图/搜索属于表现草稿，提交意图 → 本地控制器 → 主机 → 会话 reducer → 单局 reducer。主机始终是唯一权威来源。

| 目录/模块 | 职责 | 不做什么 |
|---|---|---|
| core/rules.gd | 版本、配置、字数奖励、有序资源 key 校验 | 不读文件或图片 |
| core/round_reducer.gd | 发牌、摸打、出句、三票与评分原子结算、直接清算 | 不等待动画，不搜索关键词 |
| core/invariants.gd | 测试/调试牌守恒、累计分等不变量 | 不接受客户端上传状态 |
| application/session_reducer.gd | command_id 去重、事件编号、多局历史、累计、回放 | 不依赖 UI/网络 |
| application/local_host.gd | 身份绑定入口、各玩家投影分发 | 不把全部 delivery 发给客户端 |
| application/local_table.gd | 本地交接遮挡、确认身份后提交 | 不复制规则 |
| projection/player_projection.gd | 白名单生成状态和事件投影 | 不泄露其他手牌/牌墙/逐人票 |
| presentation/meme_search.gd | 纯数据搜索与稳定排序 | 不改选图顺序，不计分 |
| presentation/content_store.gd | 文件到素材目录、key 到纹理、文案/颜色/字体角色解析、调用排序 | 不参与牌局规则 |
| presentation/main.gd | 装配、信号连接、页面路由、统一转场与焦点恢复 | 不保存投影副本或操作草稿，不构造牌局命令 |
| presentation/game_controller.gd | 当前玩家投影、选牌/选图/判断草稿、意图转命令、本地会话入口 | 不建节点、不计算通过条件或权威分数 |
| presentation/lobby_screens.gd | 菜单、交接屏和四席准备页 | 不持有主机或牌局 |
| presentation/meme_composer.gd | 搜索、候选列表、已选顺序栏、滚动与重排动效 | 不改选择数组，不提交命令 |
| presentation/ballot_view.gd | 判断/评分/等待三种显示，发出选择意图 | 不计算票数门槛，不缓存未提交判断 |
| presentation/result_view.gd | 核心清算数据与累计排名的格式化显示 | 不重新算分或排名 |
| presentation/event_feedback.gd | 投影事件通知、浮字和生命周期清理 | 不以动画回调推进状态 |
| presentation/ui_theme.gd、ui_widgets.gd | 主题与共享控件工厂 | 不持有牌局、页面或主机 |
| presentation/mahjong_table.gd | 四方牌桌、手牌、牌河、浮层区域与入场过渡 | 不持有主机或完整状态 |
| presentation/meme_player.gd | 有序图片轮播、暂停、手动翻页 | 不提交任何命令 |
| tools/content_editor | 本机素材映射编辑、上传、校验、备份；结构与规则见 [CONTENT_EDITOR.md](CONTENT_EDITOR.md) | 不是联机服务 |

GDScript 依赖 Godot 语言运行时。核心用 RefCounted 容纳静态方法，但权威状态只有 JSON 安全的字典、数组、字符串、布尔、有限数值和 null，不含节点、资源、函数或引擎对象；不访问文件、网络、系统时间或全局随机。

## 单局状态机

初始 AWAIT_ACTION（庄家）→ PROPOSE_SENTENCE → AWAIT_VOTES。

三票未收齐：保持 AWAIT_VOTES。三票收齐否决：MUST_DISCARD → 弃一张 → 下一位 AWAIT_DRAW。

三票收齐通过：原子移牌、记录句子与评分；有手牌 → 下一位 AWAIT_DRAW；手牌空 → PLAYER_WON + SETTLEMENT_STARTED + FINAL_SCORES → COMPLETED。

AWAIT_ACTION 可直接弃一张 → 下一位 AWAIT_DRAW。摸牌成功 → AWAIT_ACTION；需要摸牌且墙空 → SETTLEMENT_STARTED + FINAL_SCORES → COMPLETED。任意非终态可信 END_GAME → ABORTED。

已删除 SETTLEMENT_MEMES、SETTLEMENT_RATINGS 及其命令实现。单局完成后由会话记录并累计，UI 不补发“完成清算”。

## 数据与事务

pending 包含句子 ID、出牌者、物理牌 ID、文字、字符数组、逐位置读音、有序 resource_keys，以及私有 votes 字典。votes[player] 同时保存 approve 和 rating，故不会产生只投票未评分的半完成状态。

通过句子移除 votes，只留下 approvals 和 rating_average（分子为三人评分和、分母 3），以及原字数分 score。state.scores 是字数分总和，state.rating_bonus_thirds 是各次平均分之和的分子。二者分开避免原界面整数显示吞掉小数。最终 result.scores[player] 包含 sentence_points、rating_bonus、remaining_tiles 和 total。

reducer 复制输入，校验失败不改变牌局、不发事件；会话可以记录拒绝回执用于去重。同一动作成功后状态立即生效，异步图片/动画不影响状态。

## 搜索与资源边界

MemeSearch.rank(assets, query, glyphs) 返回独立结果副本，附 match_count 和 matched_glyphs。先筛选，再稳定排序；只计算不同选中字在 keywords 中的包含匹配。ContentStore 传入当前目录；主机不需要对关键词排序达成共识。已提交只记录资源 key 顺序，不记录机器路径。

素材 key 稳定不代表内容不可变。本版重载素材会改变该 key 对应画面；回放保证牌局数据和顺序一致，不保证素材字节与当年相同。未来联网/UGC 可用内容包版本及哈希冻结资源解释，不能把路径塞入核心代替。

## 素材表与字体配置

`content/catalog.json`（schema_version 1）包含：`title`、`theme`（七个颜色（含 digital 数字发光色））、`ui`（外置文案 key）、`assets`（8 个固定 `ui.*` + 若干 meme）、`deck` 与可选 `deck_presets`、`playback.seconds_per_image`、`font`。完整字段与校验规则见 [CONTENT_EDITOR.md](CONTENT_EDITOR.md)。

`font` 是纯表现层配置，不进入牌局状态：`families` 是有序回退链（系统字体名），`size` 是基础字号，`roles` 为 `options`（按钮）、`vote`（投票页）、`score`（结算文案与浮字）、`tile`（牌面汉字）四个角色，空字符串表示跟随默认链。`ContentStore.font(role)` 生成并缓存 `SystemFont`，共享控件工厂及具体控件按用途覆盖。评分按钮和结算数值由 `digital_number.gd` 绘制，颜色读取 `theme.digital`，不随系统字体改变。找不到字体时由系统回退，不影响状态与测试。

浮层由 mahjong_table 创建，统一动效由 ui_motion 管理：只记录稳定标识与位置；布局完成后异步 Tween 到目标，代次编号使过期任务失效。交接直接清除旧视图，不保留手牌离场副本。ordered_strip/order_chip 发出纯表现草稿的换序意图，只有提交时才把顺序送入 reducer。详见 [UI_MOTION_HANDOFF.md](UI_MOTION_HANDOFF.md)。

## 隐私、回放与后续接口

投影公开提交句子和图片、投票数量及本人是否已投；逐人分数、选择、实时平均分不公开。完成后只公开平均分。完整 journal 含牌墙与私有票，仅可信宿主保留，不能当客户端存档广播。

规则版本升为 word-tiles-4。JSON schema_version 仍为 1；不同 rules_version 不兼容，由初始化校验拒绝。旧回放使用旧 Git 版本，不在本次实现迁移。command_id 按身份去重，最终票重发不重复发牌、胜利或累计。

未来 Steam/网络、云存档、数据库、TTS、工坊都通过应用层适配器接入，核心不反向引用它们。网络适配器绑定 actor，客户端不能自报身份或覆盖状态。文本/字符/读音可给表现层异步朗读；主机只传纯数据。


2026-09-20 UI 修正：固定卡片/序号布局、图片尺寸、独立候选滚动和网页表情搜索；详见 [UI_POLISH_HANDOFF.md](UI_POLISH_HANDOFF.md)。


2026-09-25 v4：先判断、带图再评分。两步仅为本地表现流程；带图时最终仍用一个 SUBMIT_VOTE 原子提交。无图要求 rating=0，不受图片评分下界影响，非零返回 RATING_REQUIRES_MEME。v3 回放应使用旧 Git 版本，不静默按新规则解释。详见 [BALLOT_V4_HANDOFF.md](BALLOT_V4_HANDOFF.md)。
