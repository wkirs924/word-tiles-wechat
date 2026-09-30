# 2026-09-26 · 表现层拆分与接续开发

本次完成 M3/M4 工程的维护重构，规则仍为 word-tiles-4。相对基线 `545cb9c`，core、application、projection 没有改动。`main.gd` 从 719 行、45 个函数缩到 173 行、11 个函数；这些计数包含空行，不作为测试指标。

## 模块与入口

| 文件 | 职责和公开接口 | 后续修改应放哪里 |
|---|---|---|
| `presentation/main.gd` | 创建依赖、连接信号、根据 screen/phase 选择页面、转场和焦点、重载素材 | 顶栏、页面装配；不要加入投票/选牌细节 |
| `presentation/game_controller.gd` | `start_game` / `choose_seat` / `accept_handoff` / `dispatch` / `next_round`；选字选图换序、判断及评分意图 | 输入流程、草稿清理和命令上下文；规则仍交给核心 |
| `presentation/lobby_screens.gd` | `menu` / `handoff` / `ready_room`；发出开局、字库、接手、下一局信号 | 菜单和交接视觉 |
| `presentation/meme_composer.gd` | `render` / `capture_scroll` / `finish_animation` / `detach` / `reset`；发出选图、移动、拖动、收起信号 | 表情候选、搜索和已选栏 |
| `presentation/ballot_view.gd` | `render(parent, view, choice)`；发出判断、分数和返回信号 | 投票布局与评分按钮 |
| `presentation/result_view.gd` | `render(parent, view)`；发出下一局信号 | 得分表和累计排名外观 |
| `presentation/event_feedback.gd` | `present(result)` / `show_notice` / `refresh_theme` / `finish` | 通知、浮字与跳过动效 |
| `presentation/ui_theme.gd`、`ui_widgets.gd` | `build`；`label` / `button` / `row` / `panel` / `number` | 共享样式及通用控件 |
| `presentation/mahjong_table.gd` | 四方桌、牌墙计数、手牌、牌河、操作区、浮层区域 | 麻将桌布局；只读玩家投影 |
| `ui_motion.gd`、`ordered_strip.gd`、`order_chip.gd`、`meme_player.gd`、`digital_number.gd` | 排布动效、拖动组件、图片播放、电子数字 | 对应具体组件；不引入主机依赖 |

所有路径相对本工程根目录。保留现有扁平目录，没有新增框架、全局事件总线或万能管理器。

## 状态与信号边界

权威状态 → LocalTable 单席投影 → GameController → 页面。页面信号 → GameController → LocalTable → reducer；main 只连接这一链路。

GameController 仅缓存当前座位的投影。`current_view()`、`draft()`、`screen_state()` 返回独立纯数据；页面不能通过回执或 getter 修改控制器内部投影。`draft()` 包含 tile_ids、meme_keys、meme_expanded、ballot_choice、drawn_tile，都是未提交输入或临时提示，不复制计分规则。

控制器发出 `changed` 后 main 立即按最新数据重画；`composer_reset` 清理搜索/滚动；`feedback(result)` 和 `notice(message)` 只给提示层。GameController 没有节点、Tween、计时器和动画等待；LocalTable 不反向引用任何表现模块。

临时搜索词、候选滚动、候选动画归 MemeComposer。它只保留渲染所需的选图 key 和选中字副本，不保存整份投影、不修改控制器草稿。候选排序始终由 MemeSearch 计算，不改变已选图序列。交接或返回菜单立即清除草稿、旧控件和搜索，不播放含旧手牌的退出动画。

带图投票先将认可/反对留在 GameController 草稿中，再评分，一次提交 SUBMIT_VOTE。无图直接提交 rating=0。换人、返回菜单、成功提交会清理判断；评分被核心拒绝时保留草稿以便重试。禁止加出“半张已提交的票”。

MemeComposer 在两次布局帧后恢复滚动值，并验证目标控件仍是当前列表；旧页面异步任务不会写入新页面。main 退出时取消待处理转场，提示组件退出时停止 Tween。动画不发牌、不计分、不调用完成命令。

## 分阶段迁移记录

| 阶段 | Git 检查点 | 验证 |
|---|---|---|
| 原始基线 | `545cb9c` | 3551 checks，0 failures |
| 先由 main 委托主题、控件、投票/结果视图 | `667723d` | 3551 checks，0 failures |
| 委托菜单、表情面板、事件提示 | `1e2b795` | 3551 checks，0 failures |
| 迁移输入控制器，迁走测试/截图调用，移除 main 旧转发 API | `ba239bb` | 3583 checks，0 failures |
| 清理废弃映射、补滚动回归和维护检查 | 本交付提交 | 最新实测见 [M3_M4_TEST_OUTPUT.txt](M3_M4_TEST_OUTPUT.txt) |

每阶段在验证通过后提交，保留可回退检查点。没有保留两套页面实现或永久转发壳。外部若有临时调试脚本，原 `app.select_tile(...)` 等改成 `app.controller.select_tile(...)`；`reload_content` 和 `skip_animation` 仍属于 main。核心命令协议及玩法没有改变。

## 删除与修正

- 删除未使用文案：proposal、sentence、meme_add、meme_selected、ballot_hint、error_ALREADY_RATED、error_SELF_RATING_FORBIDDEN；同步移除网页中的旧预留分组。
- 保留当前仍在用的收起/展开、顺序左右移动、移除和拖动入口；它们不是废弃交互。
- 当时四张早期表情的 usage 从“结算时组合”更新为“出句时附带、投票页展示”；当时的图片、资源 key、关键词、36 个素材映射和三套 NBA 字库均保留。这是该阶段的历史记录；当前素材已切换为 `meme.gs.*`，主菜单只有 NBA 与英雄联盟两套 68 字预设，旧占位图归档位置见 [ASSET_GUIDE.md](ASSET_GUIDE.md)。
- 补齐网页文案分组里的准备页和无图评分错误提示，澄清电子数字不受系统字体角色影响。
- 修复选图后候选滚动位置丢失；返回菜单现在清理全部未提交草稿。重载后不再提供字体时，提示字的旧字体覆盖也会清除。
- 历史交接文档保留设计记录，加上当前入口说明；不得用它们恢复旧局末评分流程。

素材网页若仍打开旧版本，先处理未保存的编辑再刷新。catalog revision 已从 11 升到 12，旧页保存会被冲突检查拒绝；本次删除的是废弃界面文案 key，不是图片资源 key。

## 验收与接续要求

1. 快速 UI 回归：`godot_console --headless --path . --script res://tests/run_ui_tests.gd`，覆盖控制器、交接、投票、搜索滚动、真实轮播计时器、重排及跳过动效。
2. 提交前完整回归：`scripts/test.ps1 -Godot C:/Users/cyr/bin/godot_console.exe`，执行 `tests/run_tests.gd`。必须同时看退出码、SCRIPT ERROR、FAIL 和最终计数。
3. 映射与边界：`python -m unittest discover -s tests -p test_project_integrity.py`。检查网页分组与素材文案一一对应、动态事件/错误文案来源、图片映射、文档链接、依赖方向及跨模块私有调用。
4. 素材服务：`python tools/content_editor/test_server.py`。网页脚本另做 JavaScript 语法检查。
5. 实际渲染：`godot_console --path . --script res://tests/capture_preview.gd`，生成 13 张页面截图；这不是人工鼠标/拖动验收。试玩仍由 `PLAY.cmd` 启动。

后续优先在所属模块修改，禁止为了方便跨模块调用下划线私有方法。新功能先区分权威规则、输入草稿、页面、素材适配器；不要重新把它们全部塞回 main。仍采用小范围页面重建，并非增量控件树；本轮未做大规模性能基准。M5/M6、联网、Steam、存档恢复与 TTS 不在本轮交付内。
