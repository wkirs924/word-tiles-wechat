# GPT Sol 执行交接

你是这次重建的执行开发者。用户原话：参考现有项目重建微信端，把总体规划、开发规划、技术栈、核心代码等准备好，最后交给 GPT Sol 干。

## 明确目标

在 `E:\dev\word-tiles-wechat` 实现微信小游戏版“字有意思”。以四个真实玩家、好友房、横屏手机可玩为第一产品目标；保留 NBA/LOL 字库数据结构及回合内表情造句规则。不继续维护 Godot 微信适配链路。

## 先读什么

`AGENTS.md` → `docs/STATUS.md` → `docs/01_PRODUCT_PLAN.md` → `docs/02_ARCHITECTURE.md` → `docs/03_CONTRACTS.md` → `docs/04_IMPLEMENTATION_PLAN.md`。

事实基线是 `reference/godot`，优先读 core、application、projection、tests、docs/RULES.md。不要仅凭此交接文档凭空实现边界规则。

## 首次接手的具体工作：M1

1. 先跑现有测试，确认 Node 运行时。不要把 PATH 中 Node 20 当作可执行 `.ts` 的 Node 24。
2. 在已有 setup/scoring/search 基础上实现完整单局 reducer、会话 reducer、玩家视图、事件投影与回放。复用 snake_case 数据契约降低对照成本；TypeScript 函数名可采用 camelCase。
3. 旧逻辑允许配置变化；默认玩法必须一致。无法在本阶段完成的可选配置必须显式拒绝并记录，不得静默忽略。
4. 补充有意义的行为测试，并至少生成一条 Godot 实际输出的对照记录验证 TS 结果，不能把新实现自己的输出当作“旧版黄金样本”。如 Godot 运行受环境阻塞，记录未验证且完成独立测试。
5. 验收重复最后一票不重复结算、重放一致、拒绝不改变游戏状态、投影不泄露手牌/牌墙/逐人票、排名不先取整、终态不能再次结算。
6. 更新 `docs/STATUS.md` 和 `docs/M1_REPORT.md`，列出运行命令与结果，不停在计划或伪代码。

首次委派只要求交付 M1。后续按 M2→M5 继续，避免一个回合承诺整个产品已经完成。

## 后续实现方向

- M2：本地权威房间服务 + 四客户端协议联调 + SQLite 持久化/进程恢复。
- M3：Cocos 手机界面 + 浏览器调试适配器 + 小型素材集。
- M4：微信平台适配、开发者工具构建、Android/iOS 真机检查。
- M5：动图、性能、稳定性与交付手册。

每个阶段有任务编号、前置条件和退出条件，详见开发规划。遇到问题优先推进无需凭据的任务，不因为 AppID 缺失停止规则、服务端和客户端本地实现。

## 代码与环境提示

现有 bootstrap 已提供确定性洗牌、精确分数和素材搜索；其余内容不能假定已实现。测试使用 Node 内建 test，无需依赖安装。

本机可用 Node：`C:\Users\cyr\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`（已确认 v24.19.0）。

原 Godot：`C:\Users\cyr\bin\godot_console.exe`（存在，版本与执行能力需自行验证）。执行 Godot 对照时在本工程创建独立临时验证目录，避免导入写回原工程或 reference。

不要把 Cocos 编辑器“尚未检测”写成“已安装”。3.8.x 的实际补丁版本首次可用时固定，并写入版本记录。不要自行切换为纯 Canvas 或普通小程序。
