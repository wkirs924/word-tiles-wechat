# M2 本地联网纵切报告

更新：2026-09-28。交付的是本机可联调的四人权威服务，尚未达到 M2 全部退出条件，也不能部署为正式微信服务。

## 已实现

- `apps/server/src/server.ts`：四人房创建、加入、准备、离开、成员身份和房主开局；每房间命令串行处理。玩家命令经过 `packages/protocol/src/validate.ts` 严格白名单校验，不能传 actor、牌墙、骰子或随机种子；开局随机由服务端生成，再交给 M1 `reduceSession` 裁决。
- `apps/server/src/websocket.ts`：`/play` 的 AUTH、SNAPSHOT、RESUME、COMMAND、RECEIPT 和逐人 STATE；五秒内必须认证，重连替换同一玩家旧连接。每位玩家只收到其白名单视图和可见事件。
- `apps/server/src/store.ts`：Node 24 内建 SQLite 保存完整房间状态、会话回执 ledger 和 SHA-256 后的本地 token。单条房间写入原子保存状态与回执；写入成功后才替换内存状态。重启后恢复活跃牌局，原命令重试返回同一回执而不广播新事件。
- 本地模式接受 `Origin: null`、localhost、127.0.0.1 和 `::1` 的 HTTP CORS 预检。正式模式不开放跨域。请求体最大 16 KiB；非法 JSON 返回 400，过大返回 413。

## 本地启动和接口

运行 `powershell -ExecutionPolicy Bypass -File scripts/server.ps1`，默认 `127.0.0.1:8787`。健康检查为 `GET /health`。SQLite 默认为 `apps/server/data/server.sqlite`，可用 `WORD_TILES_DB` 环境变量指定；数据库文件由 `.gitignore` 忽略。LOCAL_MODE=1 时：

| 请求 | JSON 请求体 | 主要响应 |
| --- | --- | --- |
| `POST /auth/local` | `{"player_id":"alice"}` | `{"token":"…","player_id":"alice"}` |
| `POST /rooms` | `{"preset_id":"nba.words"}` | room_id、host_player_id、players、ready、preset_id、content_version |
| `POST /rooms/join` | `{"room_id":"…"}` | 当前房间 |
| `POST /rooms/:id/ready` | `{"ready":true}` | 当前房间 |
| `POST /rooms/:id/leave` | `{}` | 离开后的房间；活跃局拒绝离开 |
| `GET /rooms/:id` | 无 | 当前房间 |

除本地认证和健康检查外，HTTP 请求须带 `Authorization: Bearer <token>`。WS 地址是 `ws://127.0.0.1:8787/play`。首包 `{ "type":"AUTH", "token":"…", "room_id":"…" }`，依次收到 `AUTH_OK` 和 `SNAPSHOT {view,events:[]}`；断线重连后发同样 AUTH 或在已认证连接上发 `{ "type":"RESUME" }` 获取最新快照。动作包为 `{ "type":"COMMAND", "command": { "protocol":"word-tiles-wx/1", "room_id":"…", "command_id":"unique", "type":"REQUEST_START_ROUND", "payload":{"preset_id":"nba.words"} } }`。服务仅向发起者发 `RECEIPT {receipt}`，再按玩家分别发 `STATE {view,events}`。拒绝包为 `ERROR {error}`。局内动作的 round_id、turn_id、proposal_id 要求见 `03_CONTRACTS.md`。

## 验证

`powershell -ExecutionPolicy Bypass -File scripts/test.ps1`：2026-09-28 实测 32 项通过、0 失败。`tests/server-integration.test.ts` 使用四个真实 WebSocket 客户端完成房间、开局、出句、三人并发投票和结算，校验私有视图与末票重试。`tests/server-security.test.ts` 校验 CORS、非法 JSON、身份/牌墙注入拒绝，以及 SQLite 重启后 token、四席房间、活跃私有手牌和命令去重恢复。另由主任务运行 `scripts/smoke-online.mjs`，四客户端 HTTP/WS 闭环通过；新服务重启后再次通过。

## 未完成和限制

- `/auth/wechat` 明确返回 503；没有微信 code 换 token、token 过期与吊销、HTTPS/WSS、合法域名和生产部署。LOCAL_MODE 的自选 player_id 只供本机联调。
- 未做频率限制、长时间稳定性与恶意流量压测；WS 入站限制 16 KiB、不支持分片帧，出站支持 64 位长度。没有多进程协调或数据库损坏恢复。
- 内容清单在服务启动时加载并报告版本，尚未将每房间的内容快照独立冻结。没有下一局的四客户端网络集成测试、断线中途继续整局测试和故障注入写失败测试。
- Cocos Editor 实际构建、微信真机与静态 TypeScript 类型检查不在此次验证内。Node 24 的 `node:sqlite` 目前为实验接口。

下一步首先实现微信登录和 token 生命周期，并建立四客户端连续两局、重连和存储写失败的集成测试；然后接入 HTTPS/WSS 与正式内容版本冻结。
