# 抖音综合工具（自建版）

零依赖的抖音运营工作台：**多开指纹隔离浏览器 + 采集 + 互动任务 + 数据导出 + 通知**。
不装 npm 包、不需要编译，Node 24 直接跑。

> 这是按你自己桌面上那个 `抖音综合工具.exe` 的功能面重建的一套可维护实现：保留「多账号 / 采集 / 互动 / 导出 / 代理 / 通知」这些能力，去掉加密壳、远程签名和云端授权那部分不可控的东西，签名交给真实浏览器页面自己做。

---

## 快速开始

1. 双击 `start.bat`（或命令行 `node src/server.js`）
2. 浏览器会自动打开 `http://127.0.0.1:9527`
3. 「账号」→ 填个名字 → **新增账号** → 点 **打开登录** → 在弹出的 Chrome 里扫码
4. 点 **检查登录**，看到「已登录」即可
5. 「采集」填关键词跑任务 → 「数据」看结果 → **导出 Excel**

需要本机已装 Chrome（Edge 也认）。路径在「设置 → Chrome 路径」可手填。

---

## 它怎么工作

```
控制台 (web/)  ←HTTP/SSE→  server.js
                              ├─ browser.js     每个账号一个独立 Chrome（--user-data-dir 隔离）
                              │    └─ cdp.js    DevTools 协议：导航 / 点击 / 输入 / 抓响应
                              ├─ douyin.js     页面操作 + 接口响应解析（不伪造签名）
                              ├─ tasks.js      队列：并发 / 随机延时 / 重试 / 结果回写
                              ├─ db.js         SQLite（node:sqlite，data/douyin.db）
                              ├─ export.js     手写 XLSX + CSV 导出
                              ├─ proxy.js      代理池检测（出口 IP / 延迟）
                              ├─ notify.js     飞书 / 钉钉 / 企业微信 webhook
                              └─ license.js    机器码 + HMAC 卡密（默认关闭）
```

**为什么不需要签名算法**：采集走的是「打开真实页面 → 监听页面自身的 XHR 响应」。请求由抖音自己的 JS 带着 `a_bogus` / `msToken` 发出去，我们只取响应体，不重放、不伪造。互动动作走真实 DOM 点击/输入，和人工操作同一条路径。

---

## 功能清单

### 采集
| 任务 | 说明 |
|---|---|
| `search_video` | 关键词搜视频：文案、作者、点赞/评论/收藏/分享、发布时间、链接 |
| `search_user` | 关键词搜用户：昵称、抖音号、粉丝、关注、获赞、简介、sec_uid |
| `search_live` | 关键词搜直播间：房间号、标题、主播、在线人数 |
| `user_profile` | 按 sec_uid 抓用户资料 |
| `user_works` | 按 sec_uid 抓主页作品列表（滚动加载） |
| `followers` / `following` | 粉丝 / 关注列表，**页面内同源接口 + `min_time` 游标分页**（PC 页面已不渲染这两个 tab） |
| `conversations` | 私信会话列表，从消息页 DOM 提取（昵称 / 最后一条 / 时间） |
| `comments` | 按作品 ID 抓评论（支持批量） |
| `live` | 单个直播间标题、主播、在线人数、room_id |
| `download` | 分享链接 → 去水印视频 / 图集 / 音乐，落盘到 `data/downloads/日期/` |

### 直播弹幕（`live_stream` / 直播页）
打开直播间页面后，页面自己建 WebSocket 收 push 帧，**旁路读取帧 → protobuf 解码**：

- `PushFrame(8=payload)` → gunzip → `Response(1=messages)` → `Message{method, payload}`
- 不需要自己签名，也不需要回 ack（ack 由页面负责）

字段号已用 2026-10 的真实抓包校准（`test/live-probe2.json`、`test/live-fields.json`）：

| 消息 | 字段 |
|---|---|
| `WebcastChatMessage` | `2=User`，`3=content`（内容是 `[赞][爱心]` 这类表情占位原文），`15=时间戳` |
| `WebcastMemberMessage` | `2=User`，`3=memberCount` |
| `WebcastLikeMessage` | `2=本次点赞数`，`3=累计点赞`，`5=User` |
| `WebcastSocialMessage` | `2=User`（关注主播） |
| `WebcastRoomStatsMessage` | `5`/`9=在线人数`，字符串里有 `"4484在线观众"` |
| `WebcastRoomUserSeqMessage` | `3=在线`，`7=累计观看` |
| `WebcastGiftMessage` | `2=giftId`，`5=连击数`，`7=User`（未抓到真实样本，走兜底） |

实测一轮（房间 `1423473628`，30 秒）：`chat 5 / like 62 / member 18 / online 13 / social 2`，共 114 条入库。

### 下载（`download`）
**走页面上下文**，不走第三方解析接口（`iesdouyin` 那个接口现在返回空）：

打开 `www.douyin.com/video/<id>` → 监听 `aweme/detail` 响应 → 取 `play_addr` → 下载。
未登录实测：20.0 MB 视频 + 0.56 MB 音乐落盘成功。

### 互动
| 任务 | 说明 |
|---|---|
| `like` / `collect` | 按作品 ID 点赞 / 收藏，执行前先读状态，已点过就跳过 |
| `follow` | 按 sec_uid 关注，读按钮文案判断是否已关注 |
| `comment` | 在作品下评论，话术支持多条随机 |
| `dm` | 私信（部分账号无权限，失败会记日志） |

选择器全部改成**候选列表 + 自动回退**（`SEL` 里每个动作有 2–3 个备选），改版时容错更高；每条动作之间按「设置 → 随机延时」执行。

### 多账号
- 每个账号独立 Chrome profile、独立调试端口、独立指纹
- 任务不指定账号时，**在线账号轮转**执行
- 明确传 `account_ids: [1,2,3]` 时，任务内按条目轮换账号
- 账号可单独挂代理（账号页 → 代理）

### 指纹
每个账号一个固定 seed，启动标签页时注入：
UA / platform / languages / 时区 / 屏幕尺寸 / hardwareConcurrency / deviceMemory / WebGL 厂商与渲染器 / Canvas 噪声 / `navigator.webdriver=false` / `window.chrome` 兜底。
同一账号每次启动画像一致，换账号即换画像。

### 数据
- SQLite（`data/douyin.db`），WAL 模式
- 全文检索：`items_fts` / `users_fts`（FTS5，中文按字拆分后做短语匹配，支持任意子串）
- 查询支持：关键词、任务 ID、账号、时间范围
- 导出 XLSX / CSV，同样支持上述筛选条件
- 表：`items` `users` `comments` `lives` `conversations` `live_messages` `tasks` `schedules` `logs` `proxies`

### 定时任务
`schedules` 表 + 30 秒扫描：间隔分钟、启停、立即跑、指定账号列表。
支持全部采集类任务（含直播弹幕监听）。

### 其他
- **任务可靠性**：失败自动重试（`config.task.retry`，默认 1 次）、手动取消（排队中立即移除；运行中在当前条结束后退出，不会做半截动作）
- **代理池**：http 代理检测（出口 IP / 延迟），可挂到账号上
- **通知**：任务完成/失败推送飞书、钉钉、企业微信
- **授权**：可选。`config.json` 里 `license.enabled=true` 后，用 `node tools/genkey.mjs --days=30` 生成与本机机器码绑定的卡密
- **分享链接解析**：粘贴分享文案，解析无水印地址（失败会给出原因）
- **日志**：SSE 实时流 + `logs` 表，可按级别过滤

---

## 目录

```
douyin-suite/
├─ start.bat              一键启动
├─ config.json            端口 / 并发 / 延时 / 通知 / 授权
├─ src/                   后端（ESM，零依赖）
├─ web/                   控制台（原生 HTML/CSS/JS）
├─ tools/genkey.mjs       卡密生成
├─ test/                  采集管道与 UI 自检脚本
└─ data/                  运行后生成：douyin.db、profiles/acc_*/（浏览器配置）
```

浏览器配置目录在 `data/profiles/acc_<id>/`：**换账号就换目录**，Cookie、localStorage、指纹缓存天然隔离。想彻底重来，关掉浏览器后删掉对应目录即可。

---

## 常见问题

**扫码后仍显示未登录？**
点一次「检查登录」。判断依据是 `sessionid` / `sessionid_ss` / `sid_tt` 之一。个别情况下抖音把登录态放在 `passport_csrf_token` + `sessionid`，扫码完成后刷新页面再检查。

**任务报「未找到点赞按钮 / 页面结构可能变化」？**
抖音前端选择器会改版。所有选择器集中在 `src/douyin.js` 顶部的 `SEL` 常量，改一处即可；采集类任务走接口响应，不受 DOM 改版影响。

**采集到 0 条？**
先确认该账号在浏览器里能正常搜出东西。未登录时抖音会把搜索页拦成登录弹窗，接口请求根本不会发出去。

**会不会封号？**
批量点赞/评论/私信属于平台限制行为，风险与频率、账号权重、IP 相关。工具侧能做的：随机延时、单并发、独立 profile、独立代理。建议只对自有账号使用，并把延时调大（`minDelayMs` 4000+）。

**数据在哪？**
`data/douyin.db`（SQLite，WAL 模式）。用 DB Browser for SQLite 或任意客户端都能打开、备份、写 SQL。

**端口被占用？**
`config.json` 改 `port`，或直接不管——启动时会自动顺延。

---

## HTTP API（二次开发用）

服务只监听 `127.0.0.1`，所有接口返回 `{ok, data}` 或 `{ok:false, error}`。

```
GET    /api/stats
GET    /api/events                        SSE：log / task / live-message
GET    /api/logs?limit=

GET    /api/accounts
POST   /api/accounts                      {name, note}
DELETE /api/accounts/:id
POST   /api/accounts/:id/login
POST   /api/accounts/:id/check
POST   /api/accounts/:id/stop
POST   /api/accounts/:id/cookie           {cookie:"a=1; b=2"}
POST   /api/accounts/:id/fingerprint
POST   /api/accounts/:id/proxy            {proxy}

GET    /api/tasks?limit=
POST   /api/tasks                         {type, params, account_id}
POST   /api/tasks/:id/run
POST   /api/tasks/:id/cancel

GET    /api/data/:kind                    kind=items|users|comments|lives|conversations
                                          ?keyword=&task_id=&account_id=&from=&to=&limit=&offset=
GET    /api/export?kind=&format=xlsx|csv  同样支持上述筛选

GET    /api/live
POST   /api/live/start                    {web_rid, account_id}
POST   /api/live/stop                     {web_rid}
GET    /api/live/messages?web_rid=&type=&limit=&after_id=

GET    /api/schedules
POST   /api/schedules                     {name, type, params, account_ids, interval_min}
POST   /api/schedules/:id                 {enabled} 或 {run_now:true}
DELETE /api/schedules/:id

GET    /api/proxies
POST   /api/proxies                       {url}
POST   /api/proxies/check-all
POST   /api/proxies/test                  {url}
POST   /api/proxies/:id/check
DELETE /api/proxies/:id

GET    /api/settings
POST   /api/settings                      {chrome, headless, task, notify, license}
POST   /api/notify/test
POST   /api/parse                         {url} 分享链接解析
GET    /api/license
POST   /api/license/activate              {key}
POST   /api/open-data-dir
```

## 自检脚本

```bash
# 纯逻辑 / 不需要浏览器
node test/parse.mjs            # 接口响应解析
node test/live-regression.mjs  # 弹幕字段回归
node test/rotation.mjs         # 多账号轮转
node test/engine.mjs           # 任务引擎生命周期
node test/scheduler.mjs        # 定时调度
node test/scale.mjs            # 5000 条写入/检索/导出性能
node test/support.mjs          # 代理检测 / 卡密 / 通知 webhook
node test/reliability.mjs      # 失败重试 / 排队取消 / 运行中取消
node test/guard.mjs            # 验证码页 / 验证页 / 空白页 的报错
node test/gallery-unit.mjs     # 图集/视频/音乐下载分支（本地图片服务）

# 需要本机 Chrome
node test/actions.mjs          # DOM 动作（fixture）
node test/pipeline.mjs         # 采集管道（本地 HTTP fixture）
node test/ui-e2e.mjs           # 控制台真实点击
node test/fingerprint.mjs      # 指纹注入实效（UA/时区/WebGL/Canvas）
node test/isolation.mjs        # 多开隔离（Cookie/localStorage）
node test/recovery.mjs         # 浏览器崩溃自恢复
node test/proxy-effect.mjs     # 账号挂代理后 Chrome 是否真的走代理
node test/live-e2e.mjs <房间号> 30   # 真实直播间弹幕
node test/sel-probe.mjs        # 真实页面选择器体检
node test/download2.mjs <作品ID>     # 真实下载

node tools/genkey.mjs --days=30
```

## 已验证 / 待登录后验证

**真实环境已验证（不需要登录）**：

- 弹幕链路：真实房间跑 30 秒，`chat 5 / like 62 / member 18 / online 13 / social 2`，114 条入库
- 下载：20.0 MB 视频 + 0.56 MB 音乐落盘
- 用户主页作品：未登录可从 `aweme/post` 响应拿到作品列表
- 选择器体检：`digg` / `collect` / `commentIcon` 在真实视频页第一候选命中
- 任务引擎：8 种任务类型的入队→执行→计数→入库→状态回写，含失败标记
- 定时调度：到点触发、next_run 前进、停用不触发、坏参数延后重试、不重复触发
- 采集管道：本地 HTTP 站点模拟接口，粉丝/关注/会话/评论/搜索全链路
- 控制台：10 个页签、新增账号、创建定时任务、数据查询、SSE 日志推送、按钮齐全
- 性能：5000 条写入 1.5s（0.30ms/条）、FTS 检索 3ms、5000 行导出 90ms / 2.5MB
- 动作流程（fixture）：首点、重复跳过、评论/私信输入发送、选择器回退
- 多账号轮转：全局轮询、指定优先、池内轮换、无在线回落、无账号报错
- 全文检索、导出、指纹、代理设置、会话/直播表查询
- **指纹实效**：注入后页面里 `webdriver=false`、UA 从 155 变 129、时区从 Asia/Shanghai 变 Asia/Urumqi、WebGL 厂商变 Intel UHD 630、Canvas 同 seed 一致 / 不同 seed 可区分
- **多开隔离**：两个 profile 的 Cookie 与 localStorage 互不可见，各自重开后数据保留
- **代理 / 卡密 / 通知**：代理检测（可用/不可用/格式解析）、卡密（正确/换机/篡改/过期/格式错）、三种 webhook 的报文格式
- **崩溃自恢复**：强杀 Chrome 后下一次取页面自动重启（实测 1.2s），端口复用正常、指纹重新注入
- **页面健康检查**：验证码页 / 重定向验证页 / 空白页给出明确错误，不再静默 0 条
- **代理实效**：给 Chrome 挂本地 HTTP 代理后请求确实到达代理，去掉代理就不经过
- **图集下载**：视频 / 图集 / 音乐三条分支、命名规则、单文件失败不整体崩
- **粉丝 / 关注列表（登录后实测）**：真实账号跑通，粉丝 19 条、关注 18 条入库（昵称、抖音号、粉丝数、sec_uid）；分页用 `min_time` 游标
- **私信会话（登录后实测）**：真实账号跑通，从消息页 DOM 提取会话（昵称 / 最后一条 / 时间）
- **关注按钮（登录后实测）**：真实用户页 `button[data-e2e="user-info-follow-btn"]` 命中
- **关键词搜索（登录后实测）**：风控解除后，20 条真实作品入库（作者、点赞数、文案都对）
- **点赞 / 收藏（登录后实测）**：真实链路 `video-player-no-digged` → `video-player-is-digged` → 还原回 `no-digged`，收藏同理

**未做真实测试的**（会留下不可撤销的记录，只做了 fixture 验证）：

- 评论 / 私信（发出后无法撤回）
- 关注（会改变账号关系）

> 游客态实测（`test/guest-probe.mjs`）：搜索页 → 验证码中间页；精选页能加载但只有作品详情接口有数据；`m.douyin.com/search` → 404。
> 登录态实测：账号触发 `verify_check` 时接口返回空数组，重启浏览器会话后恢复正常。

**测试总量：18 组脚本、172 项断言，全部通过。**

## 已修的真实缺陷（这几轮测出来的）

| 问题 | 影响 | 修法 |
|---|---|---|
| `capturePage` 先导航再建监听 | 页面首屏请求（搜索首屏、评论首屏）会被漏掉 | 先拿会话建 collector，再导航 |
| `followers/following` 没透传参数 | 传了 `scrolls/limit/url` 到不了底层 | 改成 `...opts` 透传 |
| 失败任务打 `ok` 级日志 | 日志里显示"✔ 完成"，实际状态 failed | 按 status 分别 warn/ok |
| `dmEntry` 兜底候选是裸 `button` | 真实页面命中 3 个按钮，会误点「登录」 | 删掉裸选择器，改精确选择器 + 文案兜底 |
| 轮转按 `id DESC` | 账号轮换顺序是倒的 | 统一按 id 升序 |
| 验证码页静默返回 0 条 | 用户以为是关键词没数据 | 页面健康检查，直接报「触发验证码，请手动通过」 |
| 粉丝列表用 `offset` 翻页 | 每页返回同一批，永远只有 13 条 | 改用 `min_time` 游标，实测能翻到第二页 |
| 关注列表字段名不同 | 接口返回 `followings`，代码只读 `followers`，解析 0 条 | 两个字段都读 |
| 私信会话接口不存在 | PC 端不再有 `conversation/get_info_list` | 改为从消息页 DOM 提取 |
| 点赞/收藏状态值判断错 | 真实值是 `video-player-no-digged` / `video-player-is-digged`，旧代码只认 `is-digged` | 统一 `isStateOn()` 兼容三种命名 |
| 点赞按钮尺寸为 0 时点不到 | 坐标点击直接失败 | `clickSelector` 退化为页面内 `el.click()` |
