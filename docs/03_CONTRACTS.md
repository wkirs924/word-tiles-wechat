# 规则和协议契约

## 基线

规则版本 `word-tiles-4`；核心 schema_version=1。微信传输协议单独标识 `word-tiles-wx/1`。旧 GDScript 回放与 TypeScript 回放只有在对照测试证实后才能宣称兼容；先保留字段语义，不保证所有历史文件直接可导入。

参考优先级：原 core/application/projection 实现 + 测试 → RULES.md/CONTRACTS.md → 产品概述。

## 不得改变的规则

1. 四人、默认 136 独立物理牌。庄家按骰子和参考座位确定；逐人发 13，庄家额外一张。
2. 庄家首回合直接动作，其余正常回合先摸；两字起出句，只能使用本人真实牌，字序就是牌序。
3. 表情 key 有序、唯一、无路径，默认最多 12；关键词不参与权威计分。微信入口进一步核验 key 属于本房间冻结的素材版本。
4. 提案未通过前，牌仍属于原手牌。其他三人各投一次，必须三票齐，两票认可通过。
5. 有图投票必须同时提交 approve 与 0–3 整数 rating；即使反对者的分数也计入通过句子的平均分。无图 rating 必须为 0。
6. 通过：移牌、记录字数分与平均分。否决：本次 0 分、保持牌、转 MUST_DISCARD；不清空此前已累计的分数。
7. 字数分：2–3 字加 0，4–5 字加 1，6 字以上加 3。最终分子 = 3×(累计字数分−剩牌数)+累计各次三人评分和；分母恒为 3。
8. 只有通过句子后手牌为空才胡。单张弃光不胡。最后一张摸到后仍完成本回合，下一次该摸时墙空才流局。
9. 胡/流局在同一个动作内生成结算并记录历史；不能靠动画结束触发权威结算。
10. END_GAME 取消待投提案，ABORTED 不纳入累计、不消耗计划完成局数；保留已发生的公开记录。
11. 排名按精确分子，并列名次如 1、2、2、4；不能先四舍五入再排序。
12. 失败不改牌局、不发新事件；会话可记录失败回执用于重试去重。

## 单局状态

`AWAIT_ACTION → AWAIT_VOTES → (通过后下一人 AWAIT_DRAW / 胡 COMPLETED / 否决 MUST_DISCARD)`。
`AWAIT_DRAW → AWAIT_ACTION`；墙空则 `COMPLETED`。合法弃牌进入下一人 `AWAIT_DRAW`。可信结束到 `ABORTED`。终态不接受新的局内动作。

## 核心命令与网络命令分离

核心保留：START_NEXT_ROUND（受信任 tiles/seed 或 wall/dice）、DRAW_TILE、DISCARD_TILE、PROPOSE_SENTENCE、SUBMIT_VOTE、END_GAME。

网络只允许玩家意图：REQUEST_START_ROUND（preset_id/允许额外局）、DRAW_TILE、DISCARD_TILE、PROPOSE_SENTENCE、SUBMIT_VOTE、REQUEST_END_ROUND。服务端翻译开局/结束意图为核心命令。任何网络开局 payload 出现 seed/wall/dice/tiles 均拒绝。

```json
{
  "protocol": "word-tiles-wx/1",
  "room_id": "room-opaque-id",
  "command_id": "device-session:unique-id",
  "type": "SUBMIT_VOTE",
  "round_id": "server-round-id",
  "proposal_id": "server-round-id:3",
  "payload": { "approve": true, "rating": 2 }
}
```

round_id 对局内动作必填；turn_id 对摸、弃、出句必填；proposal_id 对投票必填。服务端不接受 actor 字段。对三名投票者不要强制同一 expected_revision：前一人的投票会推进 revision，但不会使同一 proposal 的其他合法票失效。

## 幂等和推送

幂等键 `(session_id, actor_id, command_id)`；同键同规范化内容返回原回执，不发新事件；同键不同内容 COMMAND_ID_REUSED。先查幂等再判断是否过期，确保最后一票重试在已结算后仍返回原成功。

回执字段：command_id、ok、error、revision、event_ids。只发给发起者。广播内容是每人自己的 `{view,events}`；不广播整个 deliveries 映射。

快照包括：schema/rules/content 版本、session/round/revision、本人手牌、他人牌数、公开牌河和句子、pending 的 votes_received/has_voted、结算/累计排名。不包含 wall、seed、逐人 votes、其他手牌、完整 journal、内部 authentication 数据。

## 网络基础边界

- JSON 包建议初始上限 16 KiB，消息深度 32；这些是工程限额，测试后可调整。
- 字符长度按 Unicode code points，TS 的 `string.length` 与 GDScript 不完全相同；单字用 `Array.from(glyph).length`。
- 数字拒绝 NaN/Infinity/非安全整数；布尔不可代替整数。
- 字典只使用 own properties，避免 `__proto__`/constructor 等键导致原型污染。
- 运行时验证要求对象字段白名单；TypeScript DTO 不自动完成验证。
- 客户端 resource_keys 还要经服务端当前内容清单白名单校验；UI 缺图不能改判牌局。

## 房间接口（M2 实现）

`POST /auth/wechat`：code 换内部 session token，密钥只留服务端；日志不记录 code/token/session_key。
`POST /rooms`、`POST /rooms/join`：建立/加入，四席容量和重入幂等。
`POST /rooms/:id/ready`、`POST /rooms/:id/leave`：成员绑定、准备及离开。
`WSS /play`：连接后首条 AUTH；成功前禁止动作，限制认证等待时间，不把长期 token 放到 URL。
`RESUME`：认证后返回最新玩家快照与 content_version。MVP 不做复杂事件补洞协议。

本地开发账号只在明确 LOCAL 模式开启，生产配置拒绝启用；不是可上线的微信登录替代品。
