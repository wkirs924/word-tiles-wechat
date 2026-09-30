# 字有意思 · Cocos Creator 牌桌

此目录是 Cocos Creator 3.8 系列工程源文件；当前机器尚无编辑器，尚未做编辑器导入或微信构建验收。

1. 在工程根目录运行 `powershell -ExecutionPolicy Bypass -File scripts/sync-cocos-core.ps1`，生成 `assets/scripts/generated` 中的纯规则副本和字库。该命令不会修改 Godot 参考。
2. 用 Cocos Dashboard 的 **打开项目** 选择本目录，使用 3.8.x 编辑器导入。
3. 双击 `assets/scenes/Table.scene`，在项目设置确认 1280×720 横屏设计分辨率；预览当前场景。
4. 后续微信小游戏构建需在 Cocos 编辑器的构建面板选择微信小游戏。此工程目前只提供本地四席轮流预览，尚无微信登录/联网服务。

四名玩家点击座位交接，确认遮罩后只看到该座位手牌。行动者点牌可组成有序句子（再次点牌取消），可带一个示意表情 key；摸牌/弃牌/出句和三人投票均通过 M1 会话 reducer 裁决。所有提交成功后再更新视图，失败只显示回执错误。资源只使用引擎图形和系统字形。
