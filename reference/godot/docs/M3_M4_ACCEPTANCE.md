# 当前交付：word-tiles-4 · 2026-09-26

分支 `m3-m4-playable`。当前结构与接续入口为 [PRESENTATION_REFACTOR.md](PRESENTATION_REFACTOR.md)，规则见 [RULES.md](RULES.md)。本轮按职责拆分表现层，未修改 core/application/projection；M1/M2 原始副本及历史 Git/ZIP 保留。

| 阶段 | 当前交付 | 位置 | 状态 |
|---|---|---|---|
| M1 规则核心 | 发摸打、两字句、原子投票评分、直接清算、确定性与回放 | core/、application/session_reducer.gd、tests/test_core.gd | 已实现并回归 |
| M2 投影/本地主机 | 隐藏手牌和私有票、公开有序图片、重连、去重、交接、多局 | projection/、application/、tests/test_local_table.gd | 已实现并回归 |
| M3 牌桌 UI | 四方桌、选牌、拖动字序、发摸打过渡、菜单/准备/交接、分段数字、排名 | presentation/main.gd、mahjong_table.gd、lobby_screens.gd、result_view.gd | 本地试玩可用 |
| M4 回合表情 | 关键词搜索排序、多图顺序、轮播、先判断/有图再评分 | meme_composer.gd、meme_search.gd、meme_player.gd、ballot_view.gd | 已实现并回归 |
| 输入与草稿边界 | 单席投影与草稿、失败重试、交接与菜单清理、命令上下文 | game_controller.gd、tests/test_game_controller.gd | 已实现并回归 |
| 素材与字体配置 | 36 个映射、28 张表情、3 套 NBA 字库、网页编辑/整包导入导出 | content/、content_store.gd、tools/content_editor/ | 15 组服务测试通过 |
| 维护约束 | 页面分工、文案分组、资源映射、依赖方向、文档链接 | docs/PRESENTATION_REFACTOR.md、tests/test_project_integrity.py | 5 组维护检查通过 |
| M5/M6 | Steam 联机、成就、云存档、工坊与本地化产品化 | 后续适配器 | 未实现 |

## 当前验证

- 完整入口 `scripts/test.ps1` → `tests/run_tests.gd`：**3587 checks, 0 failures；ENGINE_EXIT: 0**。
- 表现层快速入口 `tests/run_ui_tests.gd`：**258 checks, 0 failures**。包含原端到端行为，新增回执/投影隔离、菜单与换人草稿清理、评分失败重试、选图后保留搜索和滚动位置。
- 素材服务 15 组通过；维护检查 5 组通过；网页 JavaScript 语法检查通过。
- Godot 实际渲染 13 张截图全部成功，已查看表情面板、小窗评分与结算图，未见本次拆分引起的遮挡或样式变化。
- 完整结果见 [M3_M4_TEST_OUTPUT.txt](M3_M4_TEST_OUTPUT.txt)。计数为断言次数，含模拟局检查，不代表独立用例数或覆盖率。

环境仍有 Godot 根证书读取提示；无 SCRIPT ERROR 或失败断言。截图来自固定动作序列，不代替人工鼠标/拖动测试或多平台验收。

## 手动验收

`PLAY.cmd` → 主机开局 → 庄家接手 → 选字 → 搜索表情、选两图并调整顺序 → 「出牌」。三名评审依次交接，先认可/反对；有图才进入评分并原子提交，无图直接投票。三票收齐后通过/否决；通过且空手立即清算，否决强制弃一张。主机可以开始下一局。

`EDIT_MATERIALS.cmd` → 改关键词 → 保存 → 游戏重载 → 验证“开心”可匹配“开”或“心”。搜索后选图不清空查询，滚到后面选图不回顶。换人先遮挡、清理草稿；返回菜单不会残留前局选择。图片和关键词能按素材表修改，电子数字颜色由 theme.digital 控制。

后续开发遵守模块表和公开接口。网络、Steam、游戏存档恢复、AI、TTS 和工坊审核后台均未实现；本轮不是这些里程碑的完成声明。
