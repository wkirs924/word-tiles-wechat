# 素材工作台（content editor）：结构与扩展指南

面向接续模型和维护者。用户视角的使用说明在 [ASSET_GUIDE.md](ASSET_GUIDE.md)；本文件说明代码结构、接口、校验和扩展方式。

## 组成与启动

| 文件 | 职责 |
|---|---|
| `tools/content_editor/server.py` | 纯标准库本机服务：读取/校验/写入 `content/catalog.json`，上传图片，导入素材包 |
| `tools/content_editor/index.html` | 页面骨架：顶栏按钮、七个标签页、使用指南 |
| `tools/content_editor/editor.js` | 全部前端逻辑：读取、渲染各标签页、保存、上传、导入导出 |
| `tools/content_editor/style.css` | 样式（含表情卡片、按页面分组的文案、字体页） |
| `tools/content_editor/test_server.py` | 服务端回归测试（unittest，当前 15 组） |

启动/停止：双击 `EDIT_MATERIALS.cmd`，或运行 `scripts/start_editor.ps1` / `scripts/stop_editor.ps1`。默认 http://127.0.0.1:8765，同一端口只服务一个项目；游戏顶栏「素材管理」也会调用启动脚本。

## 服务端（server.py）

- 只监听 `127.0.0.1`；每次启动生成随机 token，浏览器从 `GET /api/catalog` 获取，写操作必须带 `X-Editor-Token`；同时校验 `Host` 和 `Origin` 必须是本机回环，否则 403。
- 路由（`server.py:274` 附近为静态白名单）：
  - `GET /api/catalog` → `{catalog, required_ui_assets, token, project}`
  - `GET /api/health`、`GET /assets/<path>`、`GET /`、`/index.html`、`/editor.js`、`/style.css`
  - `POST /api/upload`（图片，≤8 MB，`X-Filename` 指定扩展名，落盘到 `assets/imported/<随机>-<名字>`）
  - `POST /api/catalog`（保存；`revision` 不等则 409，防两个页面互相覆盖）
  - `POST /api/import-pack`（导入 `word-tiles-pack-1` 便携包，图片按内容哈希落到 `assets/packs/`）
  - `POST /api/shutdown`（带 token 才可停）
- 保存流程：校验 → `content/catalog.previous.json` 写入旧版 → 写临时文件 → 原子替换 `catalog.json` → `revision + 1`。
- 关键函数：`required_ui_assets`、`asset_path`（路径必须 `assets/` 内且扩展名合法）、`validate_image`（PNG/JPG/WebP 文件头，SVG 禁止脚本/外链/DTD/内联样式）、`validate_catalog`、`prepare_pack`。

### 校验规则（改数据模型时必须同步这里）

| 字段 | 规则 |
|---|---|
| 顶层 key | 必须与上一版一致；`deck_presets` 可缺省；`font` 可缺省并补默认 |
| `schema_version` | 必须为整数 1 |
| `revision` | 整数，服务端自增 |
| `theme` | 六个固定 key，值 `#RRGGBB` |
| `ui` | key 集合不可增删；值 ≤1000 字 |
| `assets` | 9 个固定字段；固定 8 个 `ui.*` 必须存在且 kind=ui；至少 1 个 meme；key 唯一且 `[A-Za-z0-9_.-]{1,128}`；路径在 `assets/` 内；meme 至少 1 个非空关键词 |
| `deck` / `deck_presets` | 每项 `{glyph, copies}`；每项必须是单个字符；张数 0–136；总和必须正好 136；预设 ≤40 套 |
| `playback.seconds_per_image` | 0.25–30 |
| `font` | `families` 1–8 个非空名（≤128 字）；`size` 12–48；`roles` 固定四个 key（options/vote/score/tile），值为 ≤128 字的字符串，可为空 |

### 扩展数据模型的步骤（重要）

新增一个顶层字段（例如 `sound`）需要同时改四处，否则保存被拒或游戏不认：

1. `server.py`：`validate_catalog` 的 key 集合比较处补默认值 + 新字段的校验。
2. `presentation/content_store.gd`：`valid_catalog` 补同样校验（游戏拒载坏文件），需要的话加读取方法。
3. `tools/content_editor/editor.js`：读取时 `normalize*` 补默认值，新增渲染/编辑 UI；导入草稿处也要兼容旧文件。
4. 若字段影响画面，在 `presentation/` 里消费它（例如字体角色的应用点）。

新增字体角色（例如 `title`）同理：`server.py:FONT_ROLES`、`content_store.gd` 的允许角色列表、`editor.js:FONT_ROLES`，再在游戏里对相应控件调用 `content.font("title")` 覆盖。

## 前端（editor.js / index.html / style.css）

标签页与渲染函数（`editor.js`）：素材映射 `renderAssets`、表情包 `renderMemes`、界面文案 `renderTexts`、主题颜色 `renderTheme`、字体 `renderFont`、试玩字库 `renderDeck` + `renderPresets`。`renderAll()` 统一重建；输入只改本地 `catalog` 并置 `dirty`，点「保存到项目」才 POST。

- **表情包页**：卡片网格，只显示图片 + 上传替换 + 关键词 + 移除；「＋ 新增表情包」复制模板生成 `meme.custom_<时间戳>`。
- **界面文案页**：`UI_GROUPS` 常量把当前使用的 `ui.*` key 按游戏页面分组，并给出每组出现位置说明；未在分组里的 key 落到「其他 / 未分类」。改游戏页面文案用途时同步这个常量。
- **字体页**：默认字体链（主字体 + 备选，可增删）与四个角色（`options`/`vote`/`score`/`tile`），角色留空 = 跟随默认；`FONT_CHOICES` 是常见字体中文名 ↔ 系统名映射，`normalizeFont()` 负责旧目录补默认。
- **保存/导入**：`#save`、`#reload`（丢弃草稿）、`#export`（下载草稿）、`#import`（载入草稿，仍需保存）；导入素材包在素材映射页顶部。

前端约束：页面 CSP 只允许同源脚本/样式（`script-src 'self'; style-src 'self'`），**不能用外部 CDN、内联脚本或内联样式**。新增 `.js`/`.css` 文件必须在 `server.py` 静态白名单里注册。

## 测试

```powershell
python tools/content_editor/test_server.py
```

测试会把 `assets/` 和 `content/` 复制到临时目录后启动线程服务器，覆盖：保存与备份、非法字数/颜色/关键词/路径/类型拒绝、上传与 SVG 安全、token/Origin/Host 权限、冲突 409、便携包导入与原子性、固定 key 契约、playback 范围、meme 关键词持久化。改动服务端或数据模型后必须全绿。字体字段的边界（1–8 项、12–48、角色字符串）已在这些用例之外由 `validate_catalog` 覆盖，新增规则时建议补进 `test_server.py`。

## 常见问题

- **提示“编辑授权失效”**：页面开了太久或服务重启过，刷新网页。
- **保存返回 409**：另一个页面先保存了。先「导出草稿」，再「重新载入」后合并。
- **想回退一版**：关游戏后把 `content/catalog.previous.json` 的内容复制为 `catalog.json`。
- **图片上传了但游戏没变**：映射要再点「保存到项目」，游戏再点「重载素材」。
- **字体不生效**：名称必须是系统字体名；保存并重载素材；角色留空时用默认链。


2026-09-20 UI 修正：固定卡片/序号布局、图片尺寸、独立候选滚动和网页表情搜索；详见 [UI_POLISH_HANDOFF.md](UI_POLISH_HANDOFF.md)。
