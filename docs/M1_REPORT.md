# M1 规则阶段报告

完成日期：2026-09-27。

## 实际实现

- `packages/core/src/json.ts`：从 `unknown` 检查 JSON 深度、有限安全数字、数组完整性、对象原型及危险键；规范化命令内容，使用安全字典保存按玩家/牌 ID 索引的数据。
- `packages/core/src/rules.ts`：完整 `word-tiles-4` 配置校验、可配置奖励表与表情 key 上限。旧规则版本明确拒绝。
- `packages/core/src/round.ts`：种子/显式牌墙建局；四人发牌、庄家首动、摸打、读音与有序图片提案、三票原子结算、否决后强制弃牌、胡/流局/可信中止。胡/流局在触发命令中直接产生最终分数。
- `packages/core/src/session.ts`：认证方传入的 actor 裁决入口；成功和失败回执去重；同 ID 改内容拒绝；多局历史、精确 thirds 累计、并列名次、回放导出与核验。
- `packages/core/src/projection.ts`：按身份白名单组装玩家快照及公开/私有事件。其他玩家手牌、牌墙和逐人投票不进入玩家投影。
- `tests/m1.test.ts`：12 项行为与 Godot 对照测试。`scripts/godot_m1_golden.gd` 和 `scripts/generate-godot-golden.ps1` 在 `.tmp/godot-m1-golden` 隔离复制参考核心运行，不修改 `reference/godot`。输出保存在 `tests/fixtures/godot-m1-golden.json`。

## 实际验证

| 命令 | 结果 |
|---|---|
| `powershell -ExecutionPolicy Bypass -File scripts/generate-godot-golden.ps1` | Godot 4.7.2 实际运行并生成固定样本。 |
| `powershell -ExecutionPolicy Bypass -File scripts/test.ps1` | Node 24.19.0，19 项通过、0 失败。 |

Godot 样本在 53 牌配置下固定 seed 42，执行开局、庄家 14 牌出句、三人带图投票和同动作胡牌。测试逐命令比较回执、事件类型、Alice 收到的事件及完整玩家视图。其他行为测试覆盖重复最后一票、拒绝不改牌局状态、三票分数、无图零评分、否决、终态、墙空流局、主持人中止、多局与计划轮数、回放及私牌隔离。

## 边界和下一步

黄金样本只证明这条固定流程与 Godot 运行结果一致，尚未覆盖所有配置或旧历史回放。当前环境未找到 `tsc`，严格 TypeScript 静态检查未运行；Node 24 直接执行 `.ts` 的测试已通过。M1 核心入口是 `reduceSession`；M0 的 `seededSetup` 和 `sentenceScore` 仍是默认规则便捷函数，权威开局与计分以 `round.ts` / `rules.ts` 为准。

下一阶段 M2 首先建立网络 DTO 的运行时白名单校验和认证身份绑定，再接单房间串行队列与事务状态/回执存储。客户端不得上传 actor、seed、wall、dice 或权威分数；网络开局只提交玩家意图。
