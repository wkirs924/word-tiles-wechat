# M1 验收记录

> 历史验收记录；当前玩法与协议以 [RULES.md](RULES.md) 和 [CONTRACTS.md](CONTRACTS.md) 的 word-tiles-3 为准。

日期：2026-09-19。结论：在下述测试环境与范围内，M1 已完成；现有核心和配套接口通过 headless 验证。不能据此声称不存在任何未发现的问题，也不代表后续 UI/联网/Steam 已实现。

## 昨天停在哪里

昨天已落地规则核心、确定性初始化、投影、本地主机、会话累计和测试；保留日志显示 3,271 次断言检查、0 次失败。README 当时引用的 CONTRACTS、MAINTENANCE、REFERENCES 尚不存在，因此文档和最终交付未完成。

本次补齐三个文档，重新阅读 ARCHITECTURE、RULES 和 README，对照实现检查规则/边界，复核 Godot 官方命令行、JSON、RNG 文档，并整理候选项目与 Steam 适配器资料。候选项目没有作为代码依赖引入。

## 本次复现并修复

| 问题 | 影响 | 修复与证据 |
|---|---|---|
| 128 字符局号生成更长句子 ID，但提交表情包仍按 128 限制 | 合法开局/胡牌后不能提交自己的表情包 | 生成句子 ID 使用独立 160 字符校验；最长局号集成回归通过 |
| ROUND_RECORDED 的 summary 与 state.history 共享可变字典 | 内部事件消费者误写数据可能绕过 reducer 修改历史 | 事件写入深副本；修改返回事件后权威状态不变的回归通过 |
| JSON 整数检查对 INT64_MIN 调用 abs 溢出 | 不安全整数被误判为 JSON 安全 | 改为双端比较；极端整数回归通过 |
| Windows PowerShell 5.1 等待进程后可能丢失 ExitCode | 核心测试通过，包装脚本仍以 1 结束 | 等待前持有进程 Handle；本次 Godot 与包装脚本均退出 0 |

在前三项修复前，新回归套件实际输出 `RESULT: 3321 checks, 3 failures`，分别对应前三个问题；修复后通过。另将同分显示改为显式稳定插入排序，避免依赖排序函数的稳定性；名次始终只比较累计分，不设置破同分规则。

测试函数现在必须返回完成标记，避免函数因 GDScript 运行时错误提前退出后被当作已经完整执行。测试包装仍额外检查 SCRIPT ERROR 与 FAIL。

## 实测环境与命令

- Windows，Godot `4.7.2.stable.official.ed1daf0bf`，GDScript，headless。
- 包装脚本调用的实际测试入口：`res://tests/run_tests.gd`。
- 没有启动 UI，没有依赖网络、数据库或 Steam 服务。

从项目目录运行：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/test.ps1 -Godot godot_console
```

本次给包装脚本额外指定工作日志目录；包装内部运行 Godot 的 `--headless --path ... --script res://tests/run_tests.gd`。日志保存在 [M1_TEST_OUTPUT.txt](M1_TEST_OUTPUT.txt)。

实际结果：

```text
RESULT: 3334 checks, 0 failures
ENGINE_EXIT: 0
```

包装脚本进程退出码：0。未出现 SCRIPT ERROR 或失败断言。检查数量包括逐动作输入不变、JSON 安全及牌守恒等断言，不能解释为 3,334 个独立用例或覆盖率。

## 覆盖范围

13 组规则测试加本地主机集成检查，包含六组固定种子的完整对局模拟与回放。重点覆盖初始 136/14/13/83 分配、显式牌墙、庄家不摸、轮转、两字门槛、奖励边界、全部八种投票组合、否决强制弃牌、剩一摸二胡牌、最后一张成句胡牌、流局表情包、无候选、精确平均数和累计分。

还覆盖各非终态 END_GAME、己方/他方权限、重复牌与越权牌、声调选择、匿名投票进度、摸牌与发牌事件隐私、重复/冲突命令、旧局/旧回合命令、同提案并发投票、最后一票重试、JSON 往返后继续执行、回放一致、事件与状态分离、本地主机重连投影和私有回放权限。

源码边界检查未发现核心调用时间、文件、网络、全局随机、节点服务或跨模块私有函数。静态脚本 preload 仅用于组织逻辑模块，不是运行时内容加载。README 与 docs 内的本地 Markdown 链接均已检查存在。

## 明确保留的限制

日志包含 Godot 启动时的 `ERROR: Failed to read the root certificate store.`，来自本机引擎读取 Windows 根证书存储，发生在规则测试之前。本次核心无网络依赖，Godot 和测试脚本均以 0 退出；未把该环境提示当作游戏断言错误，也没有修改系统证书。后续接入 HTTPS/TTS 时应在目标环境单独排查证书可用性。

本次不实现界面、动画、表情包图片与搜索、网络传输、Steam API、文件存档恢复、数据库、AI 或音频。M1 已包含这些功能需要的纯数据契约；后续验收标准在 [MAINTENANCE.md](MAINTENANCE.md)。尚未实测 macOS/Linux、导出构建或其他 Godot 4 小版本。

长会话日志/回执会持续增长，目前没有压测保证；M5 接入时需增加传输限流与日志存储策略。现有回放不是密码学审计，也不防持有权威状态的恶意主机。此前没有明确裁定的细节仍按 RULES 中列出的实现默认值执行，后续改动要同步规则版本与测试。
