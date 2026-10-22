# たすくえあ Tasquare · 交付报告

> 本文件是本轮（2026-10-22，**并线收口**）的交付记录。上一轮的报告在本仓历史里，
> 本文件只写这一轮做了什么、量到了什么、哪些留给人接手。

## 一、这一轮做了什么

这一轮的任务不是加功能，是把**一次并线**留下的断裂收拾干净：合并提交 `0ae1c36`
把两条各有半年历史的支线合成了一棵树，合成结果**两侧都不满足**，页面直接整局不可玩。

### 1. 整局不可玩（权威量具：`cos_load_sweep`）

并线后 `cos_load_sweep` 报 `LOAD-ERROR TypeError: Cannot read properties of null (reading 'addEventListener') @js/ui/app.js:334`，
报错点是 `$('mute').addEventListener` —— 页面上的 `#mute` 被并线丢了，`#fullscreen`、`#help` 同样丢了。
**整页只剩壳**：任何一次交互都会抛异常。

并线的拓扑是：共同祖先 `c844745`，一侧 `871c722`（10-05，长出暂停/静音/全屏/玩法说明与时钟、台账、动效层），
另一侧 `deeded8a`（10-07，长出全屏、"重开本题"、部署集闸与 `pages.yml` 的站点清单）。
合并把两侧的内容按块裁，于是 `index.html` 成了**本地侧的 body + 远端侧的 head**，
而 `js/ui/app.js` 是本地侧那份 —— 页面与实现对不上。

### 2. 并线引入的断裂清单与修法

| # | 断裂 | 修法 |
|---|------|------|
| 1 | 页面丢 `#mute` / `#fullscreen` / `#help` 三颗按钮，而 app.js 仍按 `$('mute')` 取 ⇒ 点声音按钮 TypeError | 三颗按钮按本地侧那份补回 `.controls` |
| 2 | 页面留着一颗**没人接线**的 `#btn-fullscreen`（app.js 从不取它），点下去什么也不会发生 | 删掉；全屏收成一颗 `#fullscreen` + 一份实现 |
| 3 | 页面 head 引用 `icons/favicon-16/32.png`，那两张图随并线留在盘上，却与另一侧的真图标集重复 | head 补回中央分发那套（16/32/48 + og-image 社交卡），两张旧 favicon 删除 |
| 4 | `js/sw-register.js`（经典脚本）与 `js/ui/pwa.js`（模块）**各注册一次** SW | 删经典脚本，页面只留 `<script type="module" src="js/ui/app.js">` |
| 5 | `manifest.webmanifest` 退成另一侧那份：丢了 `scope`/`lang`/`orientation`/`categories`/四张图标，主题色还是深色的 `#0a0a12`（页面是纸色 `#f6f4ee`） | 换回本地侧那份（七张图标、纸色主题），**不恢复 `id` 字段** |
| 6 | `css/style.css` 里两套 safe-area 兜底（`--safe-*` 与 `--sat/--sar/--sab/--sal`）并存，body 的 padding 被写了两遍 | 留一套；另一套里那条 `.fixed-bottom/.bottom-bar/...` 在本仓一条都不命中 |
| 7 | 按压反馈 `.cell.free:active` 与 `body.reduced-motion` 那组减弱动效规则被整段裁掉（标题动画还在跑） | 两条都恢复；另一侧的全局归零块保留（两者不冲突：一个管加载时的系统设置，一个管运行时的 class） |
| 8 | `window.tasquare` 里两个同名 `restart` 键：后写的把前写的盖成死代码 ⇒「探针能驱动重开本题」这条承诺调不到 | 拆名：`restart` = 重开本题、`restartRound` = 重开这一局，两个入口都在 |
| 9 | `#reset` 的文案写着"重开本题"，代码却接 `game.clear()`；`R` 键在本地侧是"重开这一局"，页面另外两处文案说的是"重开本题" | 按页面自己的文案定：**R = 重开本题**（清涂黑，题面/盘号/用时不动），"重开这一局"仍是侧栏那颗单独的按钮 |
| 10 | `pages.yml` 的注释写着"清单住在 `tools/assemble-site.sh`"，步骤却还是手抄的 `cp` ⇒ 注释在撒谎，部署集闸 W2 直接红 | 真接上 `bash tools/assemble-site.sh _site` 与 `node tools/deploy-set.mjs _site` 两步 |
| 11 | `ci.yml` 的 job 名还写着 "four node gates"（并线后是六道） | 改成 "syntax + six node gates" |
| 12 | `README.md` 停在远端侧那份（"四道 node 闸"、"第五道闸"、"无图片音频"、部署集 25/43 条） | 两侧合起来，并全部改成量出来的数 |

### 3. 闸的加强（只增不减）

- **`tools/wiring-check.sh` 第 [2b] 段补上反向那一半**：原来只查「app.js 取的 id 在不在页面上」，
  不查「页面上多出来的按钮有没有人接」—— 并线留下的 `#btn-fullscreen` 正好从这条缝里漏过去。
  现在两个方向都查：**页面上每颗带 id 的按钮都必须被 app.js 接线**（本轮 10 颗全过）。
- **`tools/scenarios.js` 续局腿的测量口径修正 + 补两条**：那条断言原来要求
  "一个 `tasquare:` 前缀的键都不剩"，量到的其实是**元数据**（页面的 `tasquare:prefs:v1` 与
  `tasquare:index:v1` 每次 load 都会重写，并线前页面还没有它们），而不是它想量的**盘面存档**。
  改成量盘面存档（`tasquare:v1:` 前缀），并补两条：应用那两个元数据键必须在位（证明不是把整个存储清空了才通过）、
  `tasquare:` 前缀下**只许**出现这三个键。断言一条没删，多了两条。

### 4. 实数钉（钉的是实数，强度不变）

`tools/deploy-set.mjs` 的 `EXPECT_CHECKS` **25 → 50**、`EXPECT_ROWS` **44 → 78**：
并线把中央分发那套图标（16/32/48/96）、og-image 社交卡与 `assets/textures` 三张位图接回了页面，
R 段因此多解析出 25 条引用。**R12 / R13 这两条断言本身没动**，它们照样在"少一条就红"的方向上咬人；
`tools/deploy-set-selftest.mjs` 的阴性对照（X10：往入口 JS 追加一行只写在注释里的假路径）
当场证明条数仍锁在 50 / 78。

## 二、真实文件清单

| 文件 | 行数 | 由谁验证 |
|------|------|----------|
| `index.html` | 107 | `tools/wiring-check.sh` 第 [2]/[2b] 段（图标与 manifest 的引用、HUD id 双向对账） |
| `css/style.css` | 259 | `tools/motif-test.mjs` §5（和纸底纹与墨面真被 body/.cell.blk 消费）+ 浏览器闸窄屏腿 |
| `js/ui/app.js` | 547 | 浏览器闸 11 条腿（真指针真按键真刷新）+ `tools/session-test.mjs` §11 |
| `js/ui/game.js` | 157 | `tools/rule-test.mjs` / `counter-test.mjs` / `pencil-test.mjs` |
| `js/ui/store.js` | 156 | `tools/session-test.mjs` §1/§2（两段解码、台账、prefs） |
| `js/ui/motion.js` | 162 | `tools/session-test.mjs` §3（30/60/120Hz 定步对拍 + 阴性对照） |
| `js/ui/audio.js` | 84 | `tools/session-test.mjs` §4（静音是真 `suspend()`） |
| `js/ui/fx.js` | 89 | `tools/session-test.mjs` §5（指针坐标换算）+ `tools/motif-test.mjs` §5（粒子贴图真被引用） |
| `js/ui/pwa.js` | 35 | `tools/session-test.mjs` §10/§11（SW 网络优先、`file:` 静默跳过、前缀形态的 URL 解析） |
| `js/engine/*` | 1,287 | rule / counter / pencil / balance 四道闸 |
| `tools/*.mjs` · `scenarios.js` · `playtest.cjs` | 3,563 | 六道 node 闸 + 浏览器闸的十一条腿 |
| `sw.js` · `manifest.webmanifest` · `server.cjs` | 191 | `tools/session-test.mjs` §10、`tools/deploy-set.mjs` |
| 位图 | 14 张 PNG | `tools/motif-test.mjs` §4/§5（IHDR 与 manifest 声明一致、盘上每张都被引用）+ `tools/deploy-set.mjs` P 段 |

## 三、本轮实数读数

- `npm run check`：syntax **OK**（js/ 与 tools/ 全进去，ESM 与 CJS 两种形状，含 server.cjs）
- `npm run wiring`：**WIRING-CHECK PASS · rc=0**（五段全过；[2b] 段 31 个 id + 10 颗按钮双向对账）
- `npm test`（六道 node 闸）：**98 / 32 / 46 / 70 / 214 / 49 checks，failed 全 0**
  （rule · counter · pencil · balance · session · motif）
- `node tools/deploy-set.mjs`：**50 条引用（含 7 张位图尺寸核对）、失败 0 项、rows 78**
- `node tools/deploy-set-selftest.mjs`：**rc=0**（十三刀逐条按预期发力，阴性对照按预期不发力）
- `bash tools/verify.sh`：**ALL GREEN · GATE_RC=0** —— `root 11/11 · 185 断言 · FAIL 0`、
  `prefix 11/11 · 185 断言 · FAIL 0`（两种 URL 形态：仓库=文档根 / Pages 的 `/<repo>/` 前缀）
- `npm run ci`（check + wiring + test + deploy-set + deploy-set:selftest + verify 整链）：**rc=0**，
  墙钟 **66 s**（本机实测，机器相关读数、不参与逐字节对账）
- `node z-biz-game-lead/003_辅助能力/polish/script/cos_load_sweep.js z-biz-game-tasquare-cos`：
  **LOADED**（并线后是 `LOAD-ERROR`）

## 四、需人接手

1. **R 键的语义**本轮定为「重开本题」（清这一局的涂黑，题面/盘号/用时都不动），
   依据是页面自己的三处文案：`#reset` 那颗按钮的 title、侧栏底部那段 `.howto`、以及键位表那一行。
   「重开这一局」（连时钟与动效一起复位）另有侧栏那颗 `#restart` 按钮，不靠键。
   若产品口径要反过来（R = 重开这一局），改三处：`js/ui/app.js` 的全局键表与键位表文案、
   `index.html` 里 `#reset` 的 title、README 的键位说明。
2. **safe-area 的让位算了两遍**（body 一份、`.bar`/`main` 各一份），刘海屏上顶部会多让一个 inset。
   这是本地侧那版 CSS 自己的设计，**不是并线带进来的**，本轮没动它（不在这一轮的范围里），
   但它是下一轮 web 精致化该收的一条。
3. **全屏的实现收成了一份**（本地侧那份），远端侧那一份的能力（webkit/ms 前缀的能力检测、
   不支持时按钮置灰并说明原因、aria-pressed 与文案回写、请求被拒时吃掉 promise）已并进同一份实现。
   若产品不要"不支持时置灰"这个口径，改 `js/ui/app.js` 的 `markFullscreenUnsupported()` 一处即可。
