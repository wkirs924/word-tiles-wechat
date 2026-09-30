# UI 小范围优化交接 · 2026-09-20

## 本轮范围
保持现有麻将牌桌和玩法，只修正表情选择及素材网页。开始时已有字体设置、自动展开、统一出牌按钮等未提交修改，本次保留并一起存档。没有改 core / application 的计分或状态机。

## 已完成
- 游戏卡片抽到 presentation/meme_card.gd，150×168 统一尺寸，130×90 缩略图，标题/关键词固定行，长文字省略、悬停可看完整内容。
- 顺序号固定在右上角，深绿底白字；选中卡片浅底深字，保持点击顺序与候选匹配排序相互独立。
- 先设置 TextureRect 的缩放模式再赋纹理，防止原图最小尺寸撑开并遮挡文字。删除 main.gd 中旧卡片布局和已无调用的 _picture。
- 搜索框位于候选图片的独立滚动区上方。保留点字自动展开、统一出牌按钮、多图按选择顺序提交。
- 素材网页增加表情名称编辑、key 展示、名称/关键词/key 搜索；改善标签对比、按钮换行、窄屏单列、键盘焦点；CSS 改为可读格式。
- 不删除用户图片、字库、关键词或旧版本备份；资源仍从 content/catalog.json 映射到 assets。

## 修改入口
| 内容 | 文件 |
|---|---|
| 单张表情卡片、序号、固定尺寸 | presentation/meme_card.gd |
| 搜索和选图草稿、出牌控制 | presentation/main.gd |
| 牌桌和面板位置 | presentation/mahjong_table.gd |
| 网页样式 | tools/content_editor/style.css |
| 网页表情搜索与编辑 | tools/content_editor/editor.js / index.html |
| 素材、关键词、字体、文字 | content/catalog.json，可用 EDIT_MATERIALS.cmd 打开网页修改 |

## 验证与限制
- 最终测试记录见 M3_M4_TEST_OUTPUT.txt。游戏测试入口 tests/run_tests.gd；网页服务测试 tools/content_editor/test_server.py。
- 实际 Godot 渲染检查使用 tests/capture_preview.gd，覆盖菜单、交接、牌桌、四图选择、投票、结算、摸牌和 1000×700 小窗。生成画面在 .local/preview（不进入 Git）。
- 浏览器已验证表情页搜索“詹姆斯”只显示对应卡片，窄窗布局正常；没有通过网页保存或改动现有素材数据。
- 当前仍为本地轮流试玩，M5 联机和 M6 Steam 尚未实现。大量素材的分页/虚拟列表留待有性能证据再做。
- 本机 Godot 启动提示无法读取系统根证书；规则测试无失败，不涉及本轮 UI 功能。

## 接续要求
先读 README、docs/RULES.md、docs/ARCHITECTURE.md 和本文。保留用户当前素材配置，不恢复旧版局末表情环节。只按明确需求增量修改；完成后跑 scripts/test.ps1 和素材服务 unittest。不要重新造一套 UI 或大规模重构。

## 保存
独立 GPT-UI-POLISH ZIP 和 Git bundle 位于项目的上级 outputs 目录，名称包含提交号；不会覆盖原 GPT 篮球包或 M1/M2 基线备份。ZIP 用于解压试玩，bundle 用于恢复 Git 历史。
