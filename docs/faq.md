# FAQ · 常见问题

### Is it free? / 免费吗？

Yes. The game and local practice bots are free and open source. No account or API key is needed for local play. Optional external model services may charge you separately.

游戏与本地陪练免费、开源。本地游玩无需注册或 key；只有主动接入外部模型时，才涉及该服务商的额度或费用。

### Can friends join from separate devices? / 能异地联机吗？

Not yet. This version provides one table per browser session, with local bots, API seats, shared-device hotseat and observation. Separate browser sessions own separate tables; opening the same URL is not joining a friend's room.

目前不支持跨设备房间。多个人可以共用一台设备轮流操作；不同浏览器会话是独立牌桌。

### Is there a hosted demo? / 有在线试玩吗？

There is no official public demo at present. Follow the README to run locally, or host your own Node server behind HTTPS. GitHub Pages alone cannot run the server.

目前请本地运行或自行部署；本项目需要 Node 服务端，不能只上传静态文件到 GitHub Pages。

### Which devices work best? / 适合什么设备？

A modern desktop browser is the main target. The table scales to the window and keeps all controls visible. Very narrow screens make the whole scene smaller; phones are not the primary experience. Chromium is used for the published captures and browser checks.

主要面向电脑浏览器。窄窗口会缩小整桌；手机并非主要体验目标。

### Can I turn down the effects? / 能减少特效吗？

Use **Settings → Light & effects**: Full shows the flowing background, foil and scoring particles; Soft keeps lighter accents; Off uses a static backdrop. The separate Animation switch and your system's reduced-motion preference stop decorative motion. The game also works without WebGL using its CSS background.

在「设置 → 光影与特效」选择华丽、柔和或关闭。关闭「动态效果」或启用系统减少动态效果即可使用静态画面；浏览器不支持 WebGL 时也能正常玩。

### Why is there no sound? / 为什么没有声音？

Table sounds are off by default. Enable them in Settings, adjust the volume, then interact with the page to unlock browser audio. Paper taps, declaration notes, capture chimes and round-result phrases are synthesized locally. There is no background music or downloaded audio pack.

音效默认关闭。在设置中开启「牌桌音效」、调整音量，再操作一次页面即可启用。纸牌、亮主、收墩和结算声音在本地合成，目前没有背景音乐。

### Why are there 33 cards? / 为什么拿到 33 张？

The dealer takes the eight-card kitty after receiving 25 cards, then buries eight to return to 25. This is part of the rules, not a display mode. Both counts use the same single-row hand.

庄家拿底后暂时是 33 张，扣回八张后恢复 25 张；不是可切换的界面模式。

### Where is my save? / 存档在哪里？

Saves live in ignored server-side `data/`, selected by the browser's cookie. Keep that cookie to reconnect. A server restart restores a table paused. Keys are held only in the session's server memory and must be entered again after restart or session expiry.

存档在服务端 `data/`；需要原浏览器 cookie 才能重新连接。重启后牌局暂停恢复，API key 不会从存档恢复。

### How strong is the AI? / AI 有多强？

Local practice bots work without any service. External models vary; their legal responses are not necessarily good strategy. We do not claim professional play or stable superiority over the practice bot. See [the evidence](research/ai-evaluation.md).

陪练无需联网；外部模型的棋力因模型与局面而异。合法出牌不等于好牌。目前不宣称职业水平或稳定强于陪练。

### Why does the page not start? / 为什么打不开？

Start the Node server and open its HTTP address; opening `public/index.html` as a local file does not run the game. If the port is already occupied, stop the other instance or choose another port (`PORT=5174 npm start` in a POSIX shell). After an update, reload the browser page.

请先启动 Node 服务，再打开本机 HTTP 地址，不要直接双击 HTML 文件。端口被占用时可停止旧实例或使用另一个端口；更新后刷新页面。

### How do I update? / 如何升级？

Stop the server, switch to `main`, run `git pull --ff-only` and `npm ci --ignore-scripts`, then restart with `npm start` and reload the page. Keep your existing `data/` and browser cookie to reconnect to local saves. Session keys must be entered again after the server restarts. The [changelog](../CHANGELOG.md) records each packaged version.

停止服务后切回 `main`，拉取更新、安装锁定依赖，再重启并刷新页面。保留 `data/` 和原浏览器 cookie 可继续存档；重启后 API key 需要重新填写。

### How can I help? / 怎么参与？

Play, report a reproducible bug, improve a translation, create art, or open a focused PR. Reviews happen periodically, not on a fixed schedule. See [contributing](../CONTRIBUTING.en.md) / [贡献指南](../CONTRIBUTING.md).
