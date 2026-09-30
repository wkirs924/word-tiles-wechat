# 本仓库 GitHub Pages

用户已选择直接公开 `wkirs924/word-tiles-wechat`，通过本仓库 GitHub Pages 游玩。不再需要独立公开仓库、跨仓库同步或 PUBLIC_WEB_TOKEN。

## 一次性配置

1. GitHub 仓库 Settings → General → Danger Zone → Change repository visibility → Public。此操作公开整个仓库及 Git 历史。
2. Settings → Pages → Build and deployment → Source 选择 **GitHub Actions**。
3. 将本次代码推送到 main 后，在 Actions 运行 **Deploy playable game to GitHub Pages**，第一次可手动 Run workflow。
4. 部署成功后使用 Pages 设置或 deployment 环境提供的网址。默认预计为 https://wkirs924.github.io/word-tiles-wechat/ ，部署完成前不能认为已可用。

以后推送到 main 的网页、规则及相关测试变更会自动测试、生成网页副本并部署。仅在本地修改不会更新 Pages。失败时保留上次成功部署的网页。使用仓库自带 GITHUB_TOKEN，不需要个人 token。

## 公开与部署范围

公开本仓库会使源码、开发文档、素材及 Git 历史可供任何人查看，无法同时将这些内容保持私密。网页 JavaScript 和素材也可下载。不要提交凭据、个人数据或玩家本地表情。已提交的凭据即使删除也仍在历史中，须撤销凭据并另行处理历史。

Pages 部署产物使用 scripts/export-public-web.mjs 的固定允许列表，只包含五份网页脚本、内容清单引用的 UI 图片/表情封面/动画图集、生成入口、说明和 .nojekyll。不会部署服务端、数据库、Godot、Cocos、微信配置、测试、开发文档或 Git 历史。但这些被跟踪的文件仍可能出现在公开仓库中。

导出拒绝越界路径、符号链接、已有输出目录、未知顶层内容字段、source map 和部分常见密钥格式，移除 sourceURL 调试指令；这些检查不能识别所有秘密。素材公开使用权仍需发布者确认。

网页支持同一设备四人轮流试玩、表情造句、投票和结算。副本隐藏没有后端的联机按钮；GitHub Pages 不运行 Node 服务，不提供跨设备联机。玩家导入的表情只在其浏览器本地保存，不参与发布。

## 本地验证

在仓库根目录运行，要求 Node.js 24+，输出目录不能已存在：

```sh
npm test
node scripts/build-preview-core.mjs
node scripts/export-public-web.mjs /tmp/word-tiles-pages
node --test tests/public-web-export.test.mjs
python3 -m http.server 8080 --bind 127.0.0.1 --directory /tmp/word-tiles-pages
```

修改素材源后仍需按原管线生成并提交 apps/wechat-preview 内容和资源。自动发布不依赖开发者电脑上的原始 GIF 目录。

本地验证不代表已公开仓库或上线 Pages。当前 API 修改可见性返回 Forbidden，需在仓库设置完成一次性配置。
