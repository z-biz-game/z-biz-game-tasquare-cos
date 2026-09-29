# Tasquare · 设计笔记

这份文件不解释"这个品类为什么好玩"。它只做一件事：把这一仓对外说过的每一句话，指回**现在还在仓里**
的那条量法，并且把**我们不敢说的话**单独列出来。文件里出现的每个数字要么有一条闸守着、要么写清它是
哪一次实测的读数与复跑命令；找不到对应量法的数字就是下一个要删掉的谎。

---

## 1 规则口径：源文本没定的三处

`js/engine/rules.js` 的 `DEFAULTS = {readA:'area', allowSingle:true, printZero:true}`。这三处都不是
"排版口味"，换掉任何一处都是**换游戏**：

| 旋钮 | 这一仓取的值 | 换掉之后会发生什么（本仓量法） |
| --- | --- | --- |
| `readA` | `area`：圈内数字 = 正交邻接的黑区**格数之和**（引文字面） | 社区常见的 `contact`（邻接黑区的**个数**）在同一位置上给的是 4 与 1 —— 判定不同。`balance` §G 用同 seed 只换读法的配对照它确实改判定。 |
| `allowSingle` | `true`：1×1 是合法的方形区，所以 `R2b` 在默认口径下不生效 | `rule-test` §4 的 N7/P7 两张题面钉住这条的语义（B=off 时 1×1 判 R2b）；`balance` §G 显示它在 12 颗种子上改的是**能铺成几张盘**（默认 5 张 vs 10 张，两边都 100% 唯一），所以这条不由产量定。 |
| `printZero` | `true`：0 是合法读数 | 关掉它，`balance` §G 那批 grown 面唯一率从 5/5 掉到 2/5 —— 这条闸的名字就是 §G 里的 `off.u < on.u`。 |

有一条几何引理兜着读数的口径：**一个实心正方形碰到框外那一格，最多共一条边**。所以 `area` 与 `wrap`
两种读法恒等，`[R4]` 的子集和判定是精确的（不会出现"同一区被数两遍"）。这条不是推理，是穷举：
`rule-test` §2 枚举 (实心方形, 外部格) 配对并要求反例数为 0，当前那次是 **3,052 对 / 反例 0**，同一节
还断言例数不低于筛选屏那次；`counter-test` §7 另有 `wrapDup ≡ 0` 的全量负控。

## 2 出货三通道（缺一整张丢弃）

`js/engine/generate.js::produceBoard` 的判定只有这三条与门，全部由引擎现算：

1. `countSolutions(...)` 在出货预算下**数到恰好 1**（`stopped` 不是读数，见 `counter.js` 的口径）；
2. `pencilSolve(...)` 在没有一条"试一下"的前提下把整盘推完（`done` ∧ `legalIfDone === 0`）；
3. 铅笔推完那张涂黑，与裁判交回的唯一解**逐格相同**。

失败必须说清死在哪一步，`receipt.fail` 的取值就是这笔账：`lay`/`whites`/`verify`/`noClue`（几何与题面
自洽层）、`cert-*`（grown 面没证到唯一）、`ship-*`（裁完之后出货裁判没证到唯一）、`pencil`（推不完）、
`truth`（铅笔与裁判不是同一张）、`draws`（重抽额度用光）。**推不完的盘不卖，也不许被写成"难题"**：
`game.js` 拿到 `!ok` 只交出一个 reject 状态，页面上摊开 `fail` 与收据，没有第四种话术。

这道与门真的会咬人，咬在哪由 `balance` §B 现量（n=60/档 的两批）：出货率
easy-6x6 98%/98% · irr-6x6 80%/80% · mid-8x8 85%/90% · irr-8x8 67%/65%，
而**失败原因只有 `pencil`**。反面证人是 `pencil-test` §3：全档取样的出货盘 33/33 张零猜测推得完。

`blacks` 一律由**裁判交回的那个唯一解**回填（`wantSolutions:true`），不用生成器自己记的几何 ——
裁完线索之后，生成器当初铺下去的那份涂黑**不再是任何解的证人**。这个坑在兄弟品类上真的烧过一次。

## 3 难度轴 = 印刷线索数，不是格子数

`TIERS` 里两档 6×6、两档 8×8 共用尺寸。理由不是省事，是量出来的：

- `balance` §C —— 同一尺寸只换档，逐对断言"线索更少的档步数不减"：6×6 上 irr-6x6（5 条，med 3 步）
  vs easy-6x6（18 条，med 1 步）；8×8 上 irr-8x8（11 条，med 4 步）vs mid-8x8（18 条，med 3 步）。
- `balance` §H —— **同一串 seed**（`pair|<档>|<局号>`，同批几何、同裁序）只换停止规则：
  "要 0 条"与"要 4 条"在 6×6 上 40/41 对、8×8 上 49/49 对出货的是**一字不差的那张盘**；
  而"要 8 条"与"要 18 条"没有一对相同（中位差 7–10 条）。

结论写死在表里：`target=4` 是一个**不存在的旋钮**（饱和点在 target 之下就到货了），所以深档的语义只能
命名为**不可约**（每条幸存线索都被 `balance` §F 现删现数证明删不掉），不能叫"裁到 4 条"。
筛选屏 ladder（rho=-0.8, n=136，仓外、不复跑）多告诉我们一件事：最底一级会反转（9 条以下反而 3/3
推得完）—— 所以档位的**下界必须由实测定**，不许顺着"线索越少越难"外推。

`band` 为什么两侧正好压在实测支撑集上（irr-6x6 下 3 / 上 12 各被一批摸到边）：seed 的局号是固定整数，
出货线索数不会随机漂，越界只可能由代码改动引起 —— 而那正是要红的时刻。`balance` §E4 是这条承诺的牙：
把 band 收到 `[0,1]`，同一批现样本必须把它推翻。

## 4 成本口径：生产路径上没有墙钟

`ship.msCap` 与 `carve.msCap` 恒为 `Infinity`，预算只有节点数。三件事叠在一起才敢这么定：

- **余量是量出来的**：全仓最贵的一次裁判调用落在 irr-8x8 的出货证书，两批 max 1,338 / 966 节点，
  预算 200,000 是它的 **149 倍**；6×6 两档 max 100–210。整盘生产墙钟八个数里 p95 最大 2.6 ms、max 4.6 ms。
- **探针上挂钟根本打不出击穿**：`counter.js` 每 256 个节点才查一次钟，而裁线索的单次探针搜索实测都在
  256 节点以内 —— `balance` §E1 起初就用 `msCap=0.0005` 写，结果 0/6 对触发。一条打不着的闸做不了负控，
  所以 §E1 改掐节点。**"生产表里没有钟"没有减少任何保护**，只是把够不着的闸从判定路径上拿掉。
- **节拍有正面证人**：`counter-test` §4 两个方向各测一次 —— `limit=1e9` 的 6×6 全空盘让 `msCap=0` 在第
  256 个节点打断并署名 `stoppedBy='ms'`；同一根钟压在一张走完只要 18 节点的 3×3 题面上一次都没停
  （`nodeCap=90` 则立刻在 91 停并署名 `'node'`）。这才叫节拍，而不是运气。

`balance` §A 把这条钉成结构不变量：谁把墙钟放回生产表，`balance` 立刻红。`certMs`/`shipMs` 仍然进收据，
但只作为观测值打印，不参与任何判定 —— 机器速度参与判定，等于让"这台机器多快"决定"画哪张盘"。

## 5 确定性

一个 seed 串 = 一条随机流：`seedOf(档, 局号)` = `tasquare|<档>|<局号>`；铺块、印数、裁序共用这一条流，
不给每张盘新建起点（那会让 UI 的"换一局"对不上任何公式）。本文件不出现 `Math.random`、`Date`、
loadavg、对象遍历序；**所有排序的随机键都在 `sort` 之前抽成数据，比较器是纯函数** —— node 与 Chrome
的 sort 对相等元素次序不同，比较器里抽随机数就会画出两张盘。

证人两层，都不靠"同 seed 自比"：`balance` §D 钉三条 PRNG 金标准（前 5 个 u32、0..9 的洗牌序、hash32
三个定值，同 seed 自比抓不到生成器被改，只有定值能钉住）；`verify.sh` 的 crossengine 腿拿 4 档 ×
局号 0–4 共 20 张盘（含 4 张自然拒盘）与 node 侧现算的指纹**逐字节**对账，另钉两条常量题面。

局号是递增整数，**不是按日期算的** —— 否则"换一局"这个按钮就在说谎。

## 6 页面的三层：页面不实现判定

- `js/engine/*` —— 无 DOM。规则、裁判、铅笔、出题。
- `js/ui/game.js` —— 无 DOM 的状态机：装盘、记账（涂黑/注白/擦除）、把引擎的答复翻译成状态。
  浏览器闸的**页内那半边**驱动的就是这一台（`app.js` 由它建出 `window.tasquare`），所以闸点的和用户
  点的不是两套东西；闸的**node 那半边不 import 这个文件**，它直接叫同一批引擎函数现算期望
  （`tools/playtest.cjs` 明写"与 `js/ui/game.js` 的 `certify()` 同一条调用"）—— 期望因此不是第二套实现。
- `js/ui/app.js` —— 只画、只派发事件。

三条口子内的规矩：

- 判定的唯一来源是 `game.verdict()` → `rules.verify()`，且**只有没有未知格才谈得上合法与否** ——
  半成品不给结论，也不给提示性报错。
- `game.certify()` 里的唯一性是浏览器**现算一遍**（`countSolutions`），不是抄服务端收据；
  页面上那句"这盘只有一个解"是这台机器上刚算出来的。
- 提示 `game.hint()` 读的是铅笔在**纯题面**上的下一条结论（不吃玩家前提），"为什么"那句来自
  `pencil.js` 的 `CLAUSES`。档位名、线索区间、步数区间全部 `tierList()` 从 `TIERS` 现读；
  规则面板逐条从 `CLAUSE_TEXT` 现读（7 个 code：R1、R2、R2b、R3、R4、R5、R6 —— R2b 只在
  `allowSingle=false` 时才可能被打出，所以标题写"一条一个编号"而不是"六条"）。
  页面上出现没人见过的代号 = `rule-test` §10 的红。
- 续玩走 `localStorage` 键 `tasquare:v1:<档>:<局号>`，只认与本题面同尺寸的存档，对不上就丢弃。
- URL 是 `#<档>/<局号>`。手打一个不存在的档位/局号时，`hashchange` 会重新 `load()` 回页面真实的那一局 ——
  不许 URL 挂着页面对不上的一句话。

## 7 五道闸 + 一段边界门，守的东西不重叠

| 闸 | 命令 | 守什么 | 这一跑的读数 |
| --- | --- | --- | --- |
| rule | `node tools/rule-test.mjs` | 语义与词汇表：题面文本形式、几何引理、候选方形表、六条条款+开关变体每条一负样本、R3 只在声明式这边可反证、条款文字表与引文的出处 | 98 checks / 0 failed |
| counter | `node tools/counter-test.mjs` | 裁判对一条**独立实现的打包枚举**（`tools/lib-packing.mjs`，完全不看线索数值）；两条保险丝各自署名；256 节点节拍的两侧 | 32 checks / 0 failed（语料 22 张题面）|
| pencil | `node tools/pencil-test.mjs` | 每条结论对**全部解**成立；八条规则没命中的必须被点名；`overrun` 不许静当成"推完了"；账本自审不出越轨 | 46 checks / 0 failed |
| balance | `npm run balance`（回填表用 SAMPLES=60）/ CI 用 24 | 档位定价与生产路径的形状：§A 结构不变量、§B 出货率、§C 难度轴、§D seed、§E 负控、§F 不可约、§G 三条语义、§H 饱和点 | 70 checks / 0 failed（SAMPLES=24/档，4 档）|
| browser | `npm run verify` | 真 headless Chrome、真 DOM、真 localStorage、真指针、真按键、真刷新：11 条腿（open domint playfull illegal pointer keyboard narrow resume reject crossengine canary）× 两种 URL 形态 | 183 断言/形态 · rc=0（部署形态另跑一遍同样 183 条，读数在 §10）|
| 边界门（不是 node 闸，所以不占"第几道闸"的号）| `bash tools/wiring-check.sh` | 四段：`js/` 不 import `tools/`（import 形状的正则，注释里提一句不算命中）、入口接线 13 条、两份 workflow 的 manifest、`_site` 的工件形状 | WIRING-CHECK PASS · rc=0；四段各被一次性副本破坏过一次，四次都 rc=1 |

CI 的 `check job` 每一步在本机都有同一条命令：`npm run ci` = `npm run check`（逐文件 `node --check`，
文件集与 CI 的 `git ls-files` 集合实测相同，14 个）+ `npm run wiring`（`tools/wiring-check.sh`：
分层、入口接线、workflow manifest、工件形状四段门）+ `npm test`（四道 node 闸）。
**这四段门住在脚本里而不是 workflow 的 `run:` 里** —— 只存在于 CI 的门本机跑不到，红的时候现场
只能放宽它，那是比红更大的损失。脚本的第 3 段还会读 workflow 自己的 manifest：注释里承诺过的步骤
如果没真的存在（今天就这样漏过 `configure-pages` 与 `upload-pages-artifact` 两步），这里直接红。

## 8 红必须点名它的闸

- 每条 `ok()` 失败都打印实测读数，`produceBoard` 的 `ship-stopped` 额外带 `stoppedBy`：分不清"节点不够"
  和"钟被踩"的红，等于让人去修错的那一半。
- 撞预算的重抽（`certStopped`）与"grown 面本来就多解"的重抽（`certRejected`）是**两笔账**，
  合并成一个数字就分不清"这题天生不唯一"和"我的预算不够" —— 这两件事的修法完全相反。
- 闸的裁决读的是**写进工件里的退出码**（`GATE_RC`），不是包装脚本的尾巴；包装脚本与工件不一致时按 FAIL 处理。
- 三条阴性自证通道实测各红一次（`SABOTAGE=1 LEGS=open|crossengine|resume`，rc=1）。一条永远同意的腿
  等于没看页面。

## 9 这一轮真的疼过的地方

写在这里是为了让下一个读到的人不必再疼一次。前五处都是**在真浏览器里**抓到的，第六处是文档自己。

1. **未闭合的属性引号**。cell 模板里 `tabindex="0` 少了右引号，解析器把 `>` 连同后面每一个 `.cell`
   都吞进同一个属性：36 格只剩 18 格，而少掉那 18 格的内容被交给了**别的格子**。"页面没报错"和
   "页面有格子"都抓不到它。所以 `domint` 腿必须**既数格数、又逐格核对这段文字属于哪一格**。
   教训：结构断言先于文字断言；看渲染结果时数节点，别读快照的白话。
2. **整块 `innerHTML` 重画把焦点丢回 `body`**，于是"方向键走格 + 回车落子"只能用一步。修在 `render()`
   里按 `data-i` 找回同一格；`keyboard` 腿现在断言"Enter 之后焦点仍在那一格"，并把派发前的
   `activeElement` 先钉住读回来。
3. **拒盘屏留着上一盘的 aria-live 读数**（一边说"这局没出证"，一边念"自由格 32：黑 1"）。
   现在 reject 分支清空 `seedline/status/result/cert/hintline` 与 violations，`reject` 腿断言这件事。
4. **手打的 hash 让 URL 声称一个页面并不在的状态**（同一文档跳 hash 不算重载，页面根本不知道）。
   `hashchange` 解析失败就重新 `load()` 回真实的那一局。
5. **仓内一句假声明**：`game.js` 曾导出 `rejectProbe`，docstring 说"把探针预算掐死，同一局号就会走
   reject 分支"。实测 3 次以上一次都没拒成 —— 探针击穿只会**多留一条线索**（方向安全），
   铅笔那一关照过。它同时也没有任何 importer。删了。
   教训：阴性自证通道必须被证明能产出负样本，否则它就是注释里的一件装饰品。
6. **文档里的数字与标题会漂**：README 与规则标题写过"六条"，而 `CLAUSE_TEXT` 是 7 个 code；
   `pages.yml` 的注释写了版本三元组 `configure-pages@v5 / upload-pages-artifact@v3 / deploy-pages@v4`，
   实际步骤却只落了最后一那个 —— 那是一条"run 报绿而工件里什么都没上传"的形状。
   教训：注释里提到的名字不能当作步骤存在过的证明。这一条现在有机器守 —— `tools/wiring-check.sh` §3
   逐行读两份 workflow 的 manifest，缺步骤就红，而且它本身被 ci.yml 调用（第 3 段还断言这件事）。

## 10 量到哪、没量到哪

- **部署形态那遍浏览器闸：量过两遍，读数逐条相同。** `ef1981d`（引擎与 UI）与 `53d3a09`（只动这两份文档）
  各自推上 main、Pages 发布之后，`npm run verify:deployed`（`SHAPES=deployed`）都在线上那一份字节上跑完 11 条腿：
  `scored 1 of 1 shapes · deployed legs 11/11 · 断言 183 条 · FAIL 0 · GATE_RC=0`（2026-09-29，
  Chrome 154.0.8037.58 / node v26.8.1，两遍工件在仓外 `_tmp-tasquare-verify-deployed*.log`）。
  同一遍还留了两条对账：线上 `/` 的 sha256 前缀与仓内 `index.html` 相同，
  而 `/tools/verify.sh`、`/server.cjs`、`/package.json` 都是 404 —— 工件边界在线上成立，不只是在 CI 里成立。
  这一腿**仍然不接进 CI**：Pages 落地有传播延迟，接进来只会多一条与代码无关的"有时红"。
- **手指与 iOS Safari：没量。** `pointer` 腿派发的是 `Input.dispatchMouseEvent`，`narrow` 腿是桌面 Chrome 的
  视口覆写（覆写发生在这一腿自己的调用里，并把 `vw/vh/dpr/#board.clientWidth` 读回来当证人 ——
  部署形态那次的读数是 `390×844×2 / #board.clientWidth 362 / 逐格命中盒 64/64 / 最小格 35.09px`）。
  两者都不等于真机触摸，也**不许对 mobile 标志本身下断言**（它可证明地改不动任何读数）。
  所以本仓不说"支持移动端"，只说"窄视口下重排正确、每格命中盒够大"。
- **6×6 与 8×8 之外的尺寸：没量**，以及 `maxSide > 3` 的铺块形状。`TIERS` 里没有的档位就没有定价，
  没有定价就没有 band 可承诺。

## 11 复跑

```bash
npm run check            # 逐文件 node --check：js/ 与 tools/ 全进去（ESM 与 CJS 两种形状），含 server.cjs
npm test                 # 四道 node 闸（CI 同形，balance 用 SAMPLES=24）
npm run balance          # SAMPLES=60 —— 回填 TIERS 的 band/steps/carve 只能用这个读数
npm run verify           # 浏览器闸：root 5611 + prefix 5612 两种形态
npm run verify:local     # 只跑 root 形态（改东西时最快的一遍）
npm run verify:deployed  # 线上字节那遍（需要 Pages 已发布）
npm run ci               # = check + test，本机跑通 ci.yml 的 check job
```

端口：root web `5611` / 前缀 web `5612` / CDP `9611`。`tools/verify.sh` 只起停自己那几份进程，
Chrome profile 按形态各一份、落在 mktemp 子目录里。
