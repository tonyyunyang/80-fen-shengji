# FAQ · 常见问题

### Is it free? / 免费吗？

Yes. The game and local practice bots are free and open source. No account or API key is needed for local play. Optional external model services may charge you separately.

游戏与本地陪练免费、开源。本地游玩无需注册或 key；只有主动接入外部模型时，才涉及该服务商的额度或费用。

### Can friends join from separate devices? / 能异地联机吗？

Not yet. This version provides one table per browser session, with local bots, API seats, shared-device hotseat and observation. Separate browser sessions own separate tables; opening the same URL is not joining a friend's room.

目前不支持跨设备房间。多个人可以共用一台设备轮流操作；不同浏览器会话是独立牌桌。

### Is there a hosted demo? / 有在线试玩吗？

Yes: **[Play 80 online](https://eighty.tonytheyang.com/)**. The Cloudflare deployment offers hosted AI, practice bots and your own URL/key connections. Local Node hosting and the optional Workers runtime are also available; GitHub Pages alone cannot run the server.

可以直接 **[在线玩 80](https://eighty.tonytheyang.com/)**，选择网站提供的 AI、陪练或自己的模型。也可本地运行 Node 服务或自行部署 Workers；只上传静态文件到 GitHub Pages 无法运行牌局。

### Which devices work best? / 适合什么设备？

Desktop browsers keep the fitted table and hover controls. Phones use larger cards in one horizontally scrolling row, fixed controls, tap selection and upward dragging. Portrait and short landscape layouts are checked at narrow viewport sizes, including the dealer's 33-card hand. Chromium is used for captures and browser checks.

电脑可悬停看牌；手机保留一排大牌，左右滑动查看，点选后确认或向上拖出。已检查手机竖屏、横屏及庄家 33 张手牌时的控件位置。

### Can I turn down the effects? / 能减少特效吗？

Use **Settings → Light & effects**: Full shows the flowing background, foil and scoring particles; Soft keeps lighter accents; Off uses a static backdrop. The separate Animation switch and your system's reduced-motion preference stop decorative motion. The game also works without WebGL using its CSS background.

在「设置 → 光影与特效」选择华丽、柔和或关闭。关闭「动态效果」或启用系统减少动态效果即可使用静态画面；浏览器不支持 WebGL 时也能正常玩。

### Why is there no sound? / 为什么没有声音？

Music and table sounds are off by default. Enable them from the menu or Settings, then interact with the page to unlock browser audio. The original After Eighty recording loops in the browser; paper, declaration, play, capture and scoring effects are synthesized locally. Music and effects have separate switches and volumes.

音乐和音效默认关闭，可在菜单或设置里开启。原创背景音乐《After Eighty》在浏览器中循环播放；发牌、亮主、出牌、收墩和结算音效在本地合成。音乐与音效可分别开关和调节音量。

### Why are there 33 cards? / 为什么拿到 33 张？

The dealer takes the eight-card kitty after receiving 25 cards, then buries eight to return to 25. This is part of the rules, not a display mode. Both counts use the same single-row hand.

庄家拿底后暂时是 33 张，扣回八张后恢复 25 张；不是可切换的界面模式。

### Where is my save? / 存档在哪里？

Local Node saves live in ignored server-side `data/`. The Cloudflare edition uses private SQLite checkpoints and archives completed deals in D1; unfinished deals do not enter the results archive. Both select the table through the browser's cookie. Keep that cookie to reconnect. A restart restores a table paused; personal keys stay only in server memory and must be entered again after restart or expiry. See [completed results](completed-results.md).

本地 Node 版的存档在服务端 `data/`；Cloudflare 版使用私有 SQLite 存档，已完成单局另外存入 D1，未完成局不进入成绩库。两种方式都依靠原浏览器 cookie 找回牌桌；重启后暂停恢复，个人 API key 不会从存档恢复。

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
