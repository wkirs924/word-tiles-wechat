# 调研与来源记录

本项目当前没有复制麻将仓库的源码、字体、图片、音效或其他资源，没有第三方麻将运行时依赖。以下项目只用于比较牌墙、发牌、轮转和流局机制；不能把候选仓库的许可证当作其所有素材的商业授权。

## 候选对比与取舍

2026-09-18 做过指定快照的静态源码阅读，没有构建或运行候选项目。2026-09-19 补齐本记录并复核官方文档；Godot 候选网页本次抓取失败，因此其结论沿用已下载的快照，不能表述为已经复核最新分支。

| 项目 | 快照与许可证 | 技术栈 / 可读性 | 可参考机制 | 必须剥离的部分 | 迁移工作量 |
|---|---|---|---|---|---|
| [zzz-103/mahjong](https://github.com/zzz-103/mahjong) | `2b5de10c2a057c4b3e429c1d370bb98d9dc6d843`；快照 LICENSE 为 MIT | Godot 4 / GDScript；基础规则与座位模块易读，控制器较长 | `basic_rule_set.gd` 的 136 牌构造、洗牌、初始发牌；`seat_order.gd` 的轮转；控制器中的摸牌/牌河/牌墙耗尽 | 和牌/听牌/吃碰杠/算番、对象状态、UI、AI、持久化；移除缺省随机回退，补独立骰子定庄 | 中；同语言，但不能直接作为纯数据 reducer 使用 |
| [ArcturusZhang/Mahjong](https://github.com/ArcturusZhang/Mahjong) | `c833d787146210f55e2ceec2cfcded40ecf53a4d`；仓库声明 MIT | Unity / C# / Photon；模型尚可读，回合与网络/计时耦合 | `MahjongSet.cs` 的墙游标与重置；`RoundStartState.cs` 的发牌；`TurnEndState.cs` 的轮转与流局；`CollectionExtension.cs` 的洗牌 | 麻将专有规则、死牌墙/岭上/宝牌、Unity/Photon/时间/动画回调、自动弃牌及全部资源 | 高；仅作规则参考，需重写成 GDScript 纯数据逻辑 |

Godot 候选的 [基础规则源码](https://github.com/zzz-103/mahjong/blob/2b5de10c2a057c4b3e429c1d370bb98d9dc6d843/scripts/rules/basic_rule_set.gd) 与 [许可证](https://github.com/zzz-103/mahjong/blob/2b5de10c2a057c4b3e429c1d370bb98d9dc6d843/LICENSE) 均按提交固定。Unity 候选的 [牌墙模型](https://github.com/ArcturusZhang/Mahjong/blob/c833d787146210f55e2ceec2cfcded40ecf53a4d/Assets/Scripts/Mahjong/Model/MahjongSet.cs) 可单独阅读。其 [README](https://github.com/ArcturusZhang/Mahjong#readme) 明确说明素材来自雀魂，因此本项目不使用这些素材。

没有因为候选支持和牌、听牌、吃碰杠或算番而加分。GPL/AGPL 项目按本次需求直接排除，例如此前查到的 [WilfriedMercier/Mahjong](https://github.com/WilfriedMercier/Mahjong)；不纳入代码借用清单。

最终选择自行实现小型核心。只借“物理牌唯一 ID → 洗牌后的顺序容器 → 初始发牌 → 游标摸牌 → 弃牌公开 → 座位轮转 → 无牌结束”的机制。汉字句子、投票、奖励、评分、投影和命令账本没有对应的可直接复用模块，强行搬运麻将控制器反而会引入无关依赖。

以后确有源码借用需求时：固定提交和目标文件 → 单独核对源码/素材许可 → 抽出牌墙或轮转的纯函数 → 替换节点/随机/计时依赖 → 用现有规则测试验证 → 加入相应版权与许可通知。不得为了省去移植工作，把整套麻将规则一起引入。

## 2026-09-19 官方资料复核

| 来源 | 本项目采用的结论 |
|---|---|
| [Godot 命令行](https://docs.godotengine.org/en/stable/tutorials/editor/command_line_tutorial.html) | 使用 headless + script 测试；`--quit-after` 是主循环迭代数；真正墙钟超时由脚本宿主处理 |
| [Godot JSON](https://docs.godotengine.org/en/stable/classes/class_json.html) | JSON 不区分整数与浮点类型；序列化往返后校验整数性，并规范生成 ID |
| [Godot RandomNumberGenerator](https://docs.godotengine.org/en/stable/classes/class_randomnumbergenerator.html) | 内建 RNG 的实现细节不应作为跨版本回放契约；核心使用固定版本的显式整数算法，也接受完整墙序 |
| [Steam Networking](https://partner.steamgames.com/doc/features/multiplayer/networking) | 后续通过独立适配器评估 Steam 网络 API；当前核心不依赖它 |
| [Steam Workshop](https://partner.steamgames.com/doc/features/workshop) | 内容共享和管理需要独立接入；纯资源 key 不等于审核或许可已经完成 |
| [Steam Community Moderation](https://partner.steamgames.com/doc/marketing/community_moderation) | 把内容治理作为产品运营能力；具体举报/屏蔽/审核流程见维护计划 |

平台政策与商业许可需要在实际接入/发布时再次核对。本记录不承诺未来 SDK 或平台审核结果，也不把当前仅有的接口预留当作已实现的 Steam 功能。
