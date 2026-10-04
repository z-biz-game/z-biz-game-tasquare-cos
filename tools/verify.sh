#!/usr/bin/env bash
# 第五道闸（浏览器闸）· たすくえあ Tasquare：真 headless Chrome、真 DOM、真 localStorage、真指针、真刷新
# —— 三种 URL 形态：
#
#   ① root      http://127.0.0.1:5611/                                    (server.cjs：仓库自己就是文档根)
#   ② prefix    http://127.0.0.1:5612/z-biz-game-tasquare-cos/            (GitHub Pages 的形状)
#   ③ deployed  https://…（线上那一份）：只有给了 DEPLOYED_URL 才跑，否则**打印理由跳过**
#
#   bash tools/verify.sh                       # 两种本地形态 × 十一条腿
#   SHAPES=root bash tools/verify.sh           # 改东西时先只跑一种
#   LEGS="open domint" SHAPES=root bash tools/verify.sh
#   CDP_PORT=9611 WEB_PORT=5611 PREFIX_PORT=5612 bash tools/verify.sh
#   DEPLOYED_URL=https://z-biz-game.github.io/z-biz-game-tasquare-cos/ SHAPES=deployed bash tools/verify.sh
#                                              # 部署件：只跑这一种形态，本脚本不起任何服务（发布后手跑，不进 CI）
#   SABOTAGE=1 LEGS=open SHAPES=root bash tools/verify.sh
#                                              # 闸的阴性自证 A：把 open 腿的期望 ok 改成 false ⇒ **必须红且 rc≠0**
#   SABOTAGE=1 LEGS=crossengine SHAPES=root bash tools/verify.sh
#                                              # 阴性自证 B：node 侧把 irr-8x8/2 那张期望题面改错一位
#   SABOTAGE=1 LEGS=resume SHAPES=root bash tools/verify.sh
#                                              # 阴性自证 C：把"新文档"证人假装成同文档片段跳转
#
# 为什么前缀形态必须单跑一遍而不是写进脚注：根形态是唯一一种能被本地服务器"蒙对"的形态。
# 页面级 `/js/...` 说明符在仓库=文档根时解得开，挂在 /<repo>/ 下就 404；而抛出来的 dynamic import
# 会把整段注入脚本一起带沉，于是部署站点静默地只跑了一小部分断言。
# tools/scenarios.js 里那个 mod() 特意按 document.baseURI 解析，就是因为这个 —— 只有前缀那一跑能看见。
#
# 端口是本仓的，不是家族的公共汽车：root web 5611 / 前缀 web 5612 / CDP 9611。
# 被占了就往后挪并打印"谁在听这一口"，绝不借别人已经绑上的 socket —— 借来的端口会发出**另一个应用**
# 的 index.html，而"页面加载成功了"分不清这件事，所以预检按字节比对磁盘上的模块。
#
# 每一条 URL 形态都用**自己新 mktemp 出来的 Chrome profile**：profile 里带着上一个形态的
# localStorage 与磁盘缓存，跨形态复用会把"首屏/续档"的读数变成别人的历史。
# 也不用 `mktemp -d -t <前缀>`：macOS 的 -t 把模板当成**前缀**并往后追加时间戳，两个形态拿到的是
# 不同的目录名却同样的语义，Linux 上 -t 干脆不是那个意思 —— 直接把模板写全。
#
# Do NOT add --use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader: software
# rasterisation saturates every core and, with no CDP client attached, Chrome will not exit
# on its own. 本闸要的是真指针与真命中盒，假光栅会让读数说谎。
set -u
HERE=$(cd "$(dirname "$0")/.." && pwd)
REPO=$(basename "$HERE")                     # the Pages path segment, same as the repo slug
FEATURE=たすくえあ                            # this app's own word: proof the bytes are ours
CDP_WANT=${CDP_PORT:-9611}
WEB_WANT=${WEB_PORT:-5611}
PREF_WANT=${PREFIX_PORT:-5612}
CHROME=${CHROME_BIN:-}
SABOTAGE=${SABOTAGE:-0}

# 每条腿的盘（都是**实测**出来的局号，不是猜的：produce 的出货/拒盘形状由 node 证人现算并断言）。
#   open/domint/playfull/illegal/pointer/keyboard 共用 easy-6x6/0 —— 6×6 出货盘，36 格，铅笔账本一步不差。
MAIN_TIER=easy-6x6; MAIN_ROUND=0
#   窄屏腿挑**最宽**那一档 irr-8x8/2（64 格，横向溢出风险最大）；390×844 + dpr 2 必须命中
#   css/style.css 那条 @media (max-width:720px)（.play 换单列、#board 靠前）。
NARROW_VIEWPORT=${NARROW_VIEWPORT:-390x844x2}
NARROW_TIER=irr-8x8; NARROW_ROUND=2
#   续局腿故意换一个**不等于默认那局**的盘：默认是 easy-6x6/0（app.js 的 DEFAULT_TIER/ROUND），
#   导航 URL 不带 fragment ⇒ 刷新后落在 mid-8x8/7 上只可能是**从 localStorage 读来的**。
RESUME_TIER=mid-8x8; RESUME_ROUND=7
#   拒盘腿：irr-8x8 的第 0、1 局是**自然**拒盘（fail=pencil），第 2 局出货 ⇒ #reject-next 两下才走到盘。
REJECT_TIER=irr-8x8
#   canary 底座：node 侧从这张出货盘出发掐停预算造负样本（nodeCap 40 < 256 ⇒ ms 闸结构上到不了）。
CANARY_TIER=irr-8x8; CANARY_ROUND=2
LEGS_DONE=${LEGS:-"open domint playfull illegal pointer keyboard narrow resume reject crossengine canary"}

if [ -z "$CHROME" ]; then
  for c in "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
           "/Applications/Chromium.app/Contents/MacOS/Chromium" \
           google-chrome chromium chromium-browser; do
    if command -v "$c" >/dev/null 2>&1 || [ -x "$c" ]; then CHROME=$c; break; fi
  done
fi
command -v python3 >/dev/null 2>&1 || { echo "需要 python3（RESULT 行的解析）" >&2; exit 2; }
command -v node >/dev/null 2>&1 || { echo "需要 node（CDP 驱动与 node 侧证人）" >&2; exit 2; }
{ command -v "$CHROME" >/dev/null 2>&1 || [ -x "$CHROME" ]; } || {
  echo "no Chrome found — 试过的路径：" >&2
  echo "  /Applications/Google Chrome.app/Contents/MacOS/Google Chrome" >&2
  echo "  CHROME_BIN=/path/to/chrome bash tools/verify.sh" >&2
  exit 2; }

# 日志与 profile 落点：不写 /tmp 根 —— 这一台机器上有别的 agent 同时在跑 Chrome。
# 默认落在 $TMPDIR（macOS 是每用户私有的 /var/folders/...，Linux runner 上退到 /tmp）。
LOGDIR=${VERIFY_LOG_DIR:-"${TMPDIR:-/tmp}/tasquare-verify"}
mkdir -p "$LOGDIR" || { echo "日志目录 $LOGDIR 建不起来" >&2; exit 2; }
rm -f "$LOGDIR"/*.tally "$LOGDIR"/*.extra.json "$LOGDIR"/*.log "$LOGDIR"/*.raw "$LOGDIR"/*.last 2>/dev/null
# 全局裁决工件：**每一条** rc 都写进这里，最后的判定从这份文件读回来 ——
# 一个包装脚本的 "exit 0" 如果其实是 `tail` 的退出码，那它就是谎。
GATE="$LOGDIR/verify-gate.log"
: >"$GATE"

# ---- ports ---------------------------------------------------------------------------------------
occupied() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t >/dev/null 2>&1; }
squatters() { lsof -nP -iTCP:"$1" -sTCP:LISTEN -t 2>/dev/null | tr '\n' ' '; }
first_free() {
  local base=$1 p
  for p in "$base" $((base + 1)) $((base + 100)) $((base + 200)); do
    if occupied "$p"; then
      echo "  端口 $p 已被别的进程听着（pid: $(squatters "$p")）——不借它的 socket，换下一个" >&2
    else
      echo "$p"; return 0
    fi
  done
  return 1
}

CUSTOM=0
[ -n "${DEPLOYED_URL:-}" ] && CUSTOM=1
if [ "$CUSTOM" = 0 ]; then
  CDP=$(first_free "$CDP_WANT") || { echo "no free devtools port near $CDP_WANT" >&2; exit 2; }
  WEB=$(first_free "$WEB_WANT") || { echo "no free http port near $WEB_WANT" >&2; exit 2; }
  PREF=$(first_free "$PREF_WANT") || { echo "no free http port near $PREF_WANT" >&2; exit 2; }
  echo "ports: CDP $CDP (want $CDP_WANT) · root web $WEB (want $WEB_WANT) · prefix web $PREF (want $PREF_WANT)"
  echo "  两种形态各用一个 HTTP 端口：origin 不同 ⇒ localStorage 各一套；Chrome/profile 按形态各一份，该形态的十一条腿共用"
else
  CDP=$(first_free "$CDP_WANT") || { echo "no free devtools port near $CDP_WANT" >&2; exit 2; }
  echo "DEPLOYED_URL=$DEPLOYED_URL → 部署件形态，本脚本不起任何服务（CDP ${CDP}）"
fi
echo "logs: $LOGDIR"
[ "$SABOTAGE" = 1 ] && echo "SABOTAGE=1 → 期望被故意改错（open 的 okWant=false · crossengine 的 ${SABOTAGE_SEED:-irr-8x8/2} 题面错位 · resume 的假刷新）：这一跑**必须**有 FAIL 且 rc≠0，绿了就是闸没咬住"
echo "loadavg（跑之前的读数，本机可能同时坐着别的 agent）：$(sysctl -n vm.loadavg 2>/dev/null || cat /proc/loadavg)"

WANT_N=$(echo "$LEGS_DONE" | wc -w | tr -d ' ')
SHAPE_WANT=$(echo "${SHAPES:-root prefix deployed}" | wc -w | tr -d ' ')
SHAPE_SCORED=0
SHAPE_RAN=""
SHAPE_SKIPPED=""

# ---- machine-readable RESULT line ----------------------------------------------------------------
# playtest.cjs 把 RESULT 打在 stdout 最后一行、console 噪音留在 stderr。这里不数行数就不叫跑过：
# 一条断言都没发生的场景（页面启动失败、import 404、场景被改名）会以"0 failed"的样子绿过去，
# 所以空 rows / 解析不出来 / 拿不到 RESULT 一律 exit 1，并把条数写进 tally 让上面那层核对
# "该报 11 段是不是只报了 10 段"。extra 落到 .extra.json：跨引擎那一腿把 20 组读数的摘要写在这里。
PARSE=$(cat <<'PARSER'
import sys, json
shape, scn, tally, extra_path = sys.argv[1:5]
raw = sys.stdin.read().strip()
if raw.startswith('RESULT '):
    raw = raw[len('RESULT '):]
if not raw:
    print('  NO RESULT —— playtest.cjs 什么都没回（见同目录的 .console.log 与 .raw）'); sys.exit(1)
try:
    d = json.loads(raw)
except Exception:
    print('  UNPARSED:', raw[:300]); sys.exit(1)
rows = d.get('rows')
if rows is None:
    print('  NO RESULT FIELD —— 回的东西不是闸的口径:', str(d)[:300]); sys.exit(1)
if not rows:
    print('  NO CHECKS RUN —— 一条都不断言的场景没有资格是绿的'); sys.exit(1)
for r in rows:
    if not r['pass']:
        print('  FAIL %-58s %s' % (r['test'], r['detail']))
fail = int(d.get('fail', 0))
extra = {k: v for k, v in d.items() if k not in ('rows', 'fail')}
# 下划线前缀的键 = **墙上时钟读数**（续局腿的 performance.timeOrigin 前后两个值就是这类）。
# 它们必须落进 .extra.json 供复验读，但绝不能进 stdout：判据是"同一条命令两次输出逐字节 diff 为空"，
# 而 timeOrigin 每一次刷新都换一个数。判据一条没放宽（这些值全都以"变了/没变"的断言形态被判定），
# 只是把机器相关的读数从可 diff 的那条通道里挪出去 —— 改的是措辞，不是阈值。
stable = {k: v for k, v in extra.items() if not k.startswith('_')}
with open(tally, 'w') as f:
    f.write('%d %d\n' % (len(rows), fail))
with open(extra_path, 'w') as f:
    json.dump(extra, f)
print('  %d checks, %d failed  %s' % (len(rows), fail, json.dumps(stable, ensure_ascii=False)[:520]))
sys.exit(1 if fail else 0)
PARSER
)

# ---- pre-flight: 即将被检的那几字节就是本仓 ---------------------------------------------------------
# 端口上坐着*别的*东西是这个闸存在的意义；"页面加载了"不够 —— SPA fallback、目录列表、孤儿 checkout
# 都能让场景跑起来，只是对着更少的文件跑。所以每个模块路径都要求 200 **且**字节数与磁盘一致。
PREFLIGHT_RELS="index.html css/style.css js/ui/app.js js/ui/game.js js/engine/rules.js js/engine/rng.js js/engine/counter.js js/engine/pencil.js js/engine/generate.js"
preflight() {
  local base=$1 rel want got f served
  served=$(curl -fsS -m 8 "$base" 2>/dev/null) || { echo "  首页取不到：$base" >&2; return 1; }
  case "$served" in *js/ui/app.js*) ;; *) echo "  $base 上发的不是本仓的首页（正文里找不到 js/ui/app.js）" >&2; return 1 ;; esac
  case "$served" in *"$FEATURE"*) ;; *) echo "  $base 在发别的应用：首页正文里找不到「${FEATURE}」" >&2; return 1 ;; esac
  for rel in $PREFLIGHT_RELS; do
    want=$(wc -c < "$HERE/$rel" | tr -d ' ')
    [ -n "$want" ] || { echo "  $rel 在磁盘上读不到，闸没有可对的基准" >&2; return 1; }
    f="$LOGDIR/preflight-$(echo "$rel" | tr '/' '_')"
    got=$(curl -sS -m 8 -o "$f" -w '%{http_code} %{size_download}' "$base$rel" 2>/dev/null) || {
      echo "  $rel 取不回来：$base$rel" >&2; return 1; }
    case "$got" in "200 $want") ;; *)
      echo "  $rel 不对味：$base$rel 回 ${got}，磁盘上的这份是 200 $want 字节" >&2
      echo "  前两行到手内容：$(head -c 160 "$f" | tr '\n' ' ')" >&2
      return 1 ;; esac
  done
  echo "  预检：首页含「${FEATURE}」与 js/ui/app.js · $(echo $PREFLIGHT_RELS | wc -w | tr -d ' ') 条真实模块路径按字节对上磁盘"
  return 0
}

start_chrome() {                  # 每一条**形态**一个新 profile、一个新 Chrome（tag 就是形态名）
  # 为什么按形态而不是按腿：这一形态的 localStorage 不许是上一形态写的，而 Chrome 起停是这条闸
  # 最贵的一段（每条腿一次起停 ≈ 多烧 11 次 Chrome 起停）。代价是同形态十一条腿共用一份档，于是
  # "谁写的档谁收尾"成了纪律：pointer / keyboard / resume / reject / playfull / illegal 每条腿在腿内
  # 自己先 wipeSaves()+loadClean()；boot 那条"新 profile 上无档可续"靠的是下面 run_shape 里那句
  # 「先把 tab 停在 404 上、应用页一次都没跑过」+ 它排在清单最前。把清单换个顺序真跑过
  # （LEGS="resume open"）：open 会红一片并 rc=1，是响的，不是假绿。
  local tag=$1
  UDD=$(mktemp -d "${LOGDIR}/profile.${tag}.XXXXXXXX") || { echo "profile 建不起来" >&2; return 1; }
  "$CHROME" --headless=new --remote-debugging-port=$CDP --user-data-dir="$UDD" \
    --window-size=1280,1024 --no-first-run --no-default-browser-check about:blank \
    >"$LOGDIR/chrome-$tag.log" 2>&1 &
  CPID=$!
  for i in $(seq 1 120); do
    curl -fsS -m 1 "http://127.0.0.1:$CDP/json/version" >/dev/null 2>&1 && return 0
    sleep 0.5
  done
  echo "devtools never bound on :$CDP (see $LOGDIR/chrome-$tag.log)" >&2
  return 3
}
stop_chrome() {
  [ -n "${CPID:-}" ] && { kill -9 "$CPID" 2>/dev/null; wait "$CPID" 2>/dev/null; }
  [ -n "${UDD:-}" ] && rm -rf "$UDD"
  CPID=""; UDD=""
  return 0
}

# run_leg <shape> <leg> —— 腿名到"场景 / mode / 导航 URL / node 期望"的那张表在这里，只有一处。
run_leg() {
  local shape=$1 leg=$2 base=$3 s expect='' nav='' mode=scenario
  local vp=$VIEWPORT mob=0             # 默认走这一形态的视口；只有窄屏腿自己换（见 narrow）
  local RUNBAD=0
  s=$leg
  case "$leg" in
    open)
      s=open
      nav="${base}#${MAIN_TIER}/${MAIN_ROUND}"
      expect=$(node tools/playtest.cjs witness "$MAIN_TIER" "$MAIN_ROUND") || { echo "  node 证人起不来（$MAIN_TIER/${MAIN_ROUND}）" >&2; RUNBAD=1; return; }
      # 阴性自证：把期望的 ok 改成 false —— 页面明明出了货，这条必须红。一条永远同意的 open 等于没看页面。
      [ "$SABOTAGE" = 1 ] && expect=$(printf '%s' "$expect" | python3 -c 'import sys,json;d=json.load(sys.stdin);d["okWant"]=False;print(json.dumps(d))')
      ;;
    domint)
      nav="${base}#${MAIN_TIER}/${MAIN_ROUND}"
      expect=$(node tools/playtest.cjs witness "$MAIN_TIER" "$MAIN_ROUND") || { echo "  node 证人起不来" >&2; RUNBAD=1; return; }
      ;;
    playfull)
      mode=interact
      nav="${base}#${MAIN_TIER}/${MAIN_ROUND}"
      expect=$(node tools/playtest.cjs witness "$MAIN_TIER" "$MAIN_ROUND") || { echo "  node 证人起不来" >&2; RUNBAD=1; return; }
      ;;
    illegal)
      mode=interact
      nav="${base}#${MAIN_TIER}/${MAIN_ROUND}"
      expect=$(node tools/playtest.cjs witness "$MAIN_TIER" "$MAIN_ROUND") || { echo "  node 证人起不来" >&2; RUNBAD=1; return; }
      ;;
    pointer)
      mode=interact
      nav="${base}#${MAIN_TIER}/${MAIN_ROUND}"
      expect=$(node tools/playtest.cjs witness "$MAIN_TIER" "$MAIN_ROUND") || { echo "  node 证人起不来" >&2; RUNBAD=1; return; }
      ;;
    keyboard)
      mode=interact
      nav="${base}#${MAIN_TIER}/${MAIN_ROUND}"
      expect=$(node tools/playtest.cjs witness "$MAIN_TIER" "$MAIN_ROUND") || { echo "  node 证人起不来" >&2; RUNBAD=1; return; }
      ;;
    narrow)
      # 窄屏/移动端腿：视口与 dpr 的覆写发生在**这条腿自己那一次 playtest 调用**里（attach 之后、
      # 首次导航之前、同一个 CDP session）。绝不另起一个进程设覆写就退出 —— 那样跑断言的进程从没被覆写，
      # 在 vw 1280 / dpr 1 下把桌面那套断言又跑一遍，报出与桌面腿**相同的条数**（这一族最贵的假绿）。
      # 判据：读回的 vw/dpr/clientWidth/innerHeight 必须与请求的对上。**不**断"mobile 标志本身"：
      # 那个标志是给 Chrome 的，不是给页面的判据；断它就会把 Chrome 的行为当成结论。
      vp=$NARROW_VIEWPORT
      mob=1
      nav="${base}#${NARROW_TIER}/${NARROW_ROUND}"
      expect=$(node tools/playtest.cjs witness "$NARROW_TIER" "$NARROW_ROUND") || { echo "  node 证人起不来（$NARROW_TIER/${NARROW_ROUND}）" >&2; RUNBAD=1; return; }
      expect=$(printf '%s' "$expect" | python3 -c '
import sys, json
d = json.load(sys.stdin)
p = sys.argv[1].split("x")
d["vwWant"] = int(p[0]); d["vhWant"] = int(p[1])
d["dprWant"] = int(p[2]) if len(p) > 2 else 1
d["mobileWant"] = True
print(json.dumps(d))' "$vp") || { echo "  窄屏腿的视口三元组拼不进 expect（${vp}）" >&2; RUNBAD=1; return; }
      ;;
    resume)
      # 续局腿：导航 URL **不带 fragment** —— 盘只能来自默认或存档，刷新后落在 RESUME_TIER/ROUND
      # 才是"续的是档"的正面证据（默认是 easy-6x6/0，与这里要的 mid-8x8/7 不同档不同局号）。
      mode=interact
      nav="$base"
      expect=$(node tools/playtest.cjs witness "$RESUME_TIER" "$RESUME_ROUND") || { echo "  node 证人起不来（$RESUME_TIER/${RESUME_ROUND}）" >&2; RUNBAD=1; return; }
      # 阴性自证：把"新文档"这个证人**假装成同文档片段跳转**（哨兵/timeOrigin/href 三条当场红）
      [ "$SABOTAGE" = 1 ] && expect=$(printf '%s' "$expect" | python3 -c 'import sys,json;d=json.load(sys.stdin);d["fakeReload"]=1;print(json.dumps(d))')
      ;;
    reject)
      # 拒盘腿：三局的期望**一次**由 node 证人交回（0/1 自然拒盘 · 2 出货），页内只比对。
      mode=interact
      nav="${base}#${REJECT_TIER}/0"
      expect=$(node tools/playtest.cjs witness "$REJECT_TIER" "0,1,2") || { echo "  node 证人起不来（$REJECT_TIER 的 0/1/2 三局）" >&2; RUNBAD=1; return; }
      ;;
    crossengine)
      # 跨引擎对账：页侧只交回 4 档 × 5 局的题面三元组，逐条比发生在 node 侧
      # （playtest.cjs 的 crossEngineRows：它 import 的就是浏览器加载的那批 js/ 模块）。
      nav="$base"
      ;;
    canary)
      # 负样本 canary：三条通道（自然拒盘 / 掐停出货预算 / 掐停裁线索探针）的期望读数由 node 侧证人算，
      # 页内只重跑并比对。掐停只许 nodeCap（<256 ⇒ counter.js 每 256 个节点才查一次的 ms 闸结构上到不了）——
      # 用 msCap 造负样本会让盘形跟着机器速度变，那是本组织的红线，一条都不许碰。
      nav="${base}#${MAIN_TIER}/${MAIN_ROUND}"
      expect=$(node tools/playtest.cjs canary "$CANARY_TIER" "$CANARY_ROUND") || {
        echo "  canary 的 node 证人交不出负样本（$CANARY_TIER/${CANARY_ROUND}）" >&2; RUNBAD=1; return; }
      ;;
    *) echo "  不认识这条腿：$leg" >&2; RUNBAD=1; return ;;
  esac

  local art raw last clog parsed tally extra n m pt_rc pr_rc
  art="$LOGDIR/$shape-$s.log"; raw="$LOGDIR/$shape-$s.raw"; last="$LOGDIR/$shape-$s.last"
  clog="$LOGDIR/$shape-$s.console.log"; tally="$LOGDIR/$shape-$s.tally"; extra="$LOGDIR/$shape-$s.extra.json"
  rm -f "$tally" "$extra" "$art" "$raw" "$last"
  : >"$art"
  echo "=== [$shape] ${leg}（场景 $s · mode=${mode} · viewport ${vp} · mobile ${mob} · nav ${nav}）" | tee -a "$art"
  VIEWPORT=$vp EMULATE_MOBILE=$mob NAV_URL=$nav SABOTAGE=$SABOTAGE \
    node tools/playtest.cjs "$mode" "$s" "$expect" >"$raw" 2>"$clog"
  pt_rc=$?
  echo "PT_RC=$pt_rc" >>"$art"
  tail -1 "$raw" >"$last"
  python3 -c "$PARSE" "$shape" "$s" "$tally" "$extra" <"$last" >"$LOGDIR/$shape-$s.parsed" 2>&1
  pr_rc=$?
  cat "$LOGDIR/$shape-$s.parsed" | tee -a "$art"
  # 这条腿的 rc **写进工件本身**：上面那句 tee 的退出码是 tee 的，不是裁决；裁决只从 GATE_RC 那一行读回来。
  echo "GATE_RC=$pr_rc" >>"$art"
  if [ -s "$tally" ]; then
    read -r n m <"$tally"
    SHAPE_REPORTED=$((SHAPE_REPORTED + 1))
    echo "LEG $shape $s rc=$pr_rc rows=$n fails=$m" >>"$GATE"
  else
    echo "LEG $shape $s rc=RUNBAD rows=0 fails=1" >>"$GATE"
    echo "  没有 tally：$s 这一跑连条数都没交出来，不能算跑过" | tee -a "$art"
  fi
  if [ -s "$clog" ]; then
    echo "  --- console（tail 8）---"
    sed 's/^/  /' "$clog" | tail -8 | tee -a "$art"
  fi
  [ "$pt_rc" = 0 ] || echo "  playtest 自身退出码 ${pt_rc}（非 0 ⇒ 这一腿没跑成，见 ${art}）" | tee -a "$art"
  return 0
}

# ---- one shape -----------------------------------------------------------------------------------
run_shape() {
  local shape=$1 base s t0 t1
  t0=$SECONDS
  SHAPE_REPORTED=0
  VIEWPORT=${VIEWPORT_DEFAULT:-1280x1024}
  if [ "$shape" = deployed ]; then
    base=${DEPLOYED_URL%/}/
    SPID=0; PPID2=0
  elif [ "$shape" = root ]; then
    base="http://127.0.0.1:$WEB/"
    PORT=$WEB node "$HERE/server.cjs" >"$LOGDIR/$shape-server.log" 2>&1 &
    SPID=$!; PPID2=0
  else
    # Pages 形状：仓库挂在**一个路径段**下。用的就是产品自己那份 server.cjs（PREFIX=/<仓名>），
    # 不另起一个 python 服务器 —— 生产怎么服务，闸就怎么服务，裸 / 404 这类形状差异才有意义。
    base="http://127.0.0.1:$PREF/$REPO/"
    PREFIX="/$REPO" PORT=$PREF node "$HERE/server.cjs" >"$LOGDIR/$shape-server.log" 2>&1 &
    PPID2=$!; SPID=0
  fi
  BASE=$base
  export CDP_PORT=$CDP
  export BASE_URL=$BASE
  start_chrome "$shape" || return 5
  if [ "$shape" != deployed ]; then
    for i in $(seq 1 40); do curl -fsS -m 1 "$BASE" >/dev/null 2>&1 && break; sleep 0.25; done
  fi
  echo
  echo "################ shape=$shape  base=$BASE  (CDP :$CDP, profile $UDD)"
  if ! preflight "$BASE"; then
    echo "LEG $shape PREFLIGHT rc=PREFLIGHT rows=0 fails=1" >>"$GATE"
    stop_chrome
    [ "${SPID:-0}" != 0 ] && { kill $SPID 2>/dev/null; wait $SPID 2>/dev/null; }
    [ "${PPID2:-0}" != 0 ] && { kill $PPID2 2>/dev/null; wait $PPID2 2>/dev/null; }
    SPID=0; PPID2=0
    return 2
  fi

  # 先在一个**本 origin 的 404 路径**上把 tab 拉起来：origin 对得上 ⇒ 后面的场景腿复用这个 tab，
  # 而应用页一次都没跑过 ⇒ tasquare:v1:* 还是空的，open 那条"新 profile 上无档可续"才是真的。
  VIEWPORT=$VIEWPORT node tools/playtest.cjs open "${BASE}tasquare-probe-404" | head -2

  for s in $LEGS_DONE; do
    run_leg "$shape" "$s" "$BASE"
  done

  t1=$((SECONDS - t0))
  SHAPE_SCORED=$((SHAPE_SCORED + 1))
  SHAPE_RAN="$SHAPE_RAN $shape"
  echo "---- shape=$shape 汇总：scored 这一形态报回 $SHAPE_REPORTED/$WANT_N 段（墙上耗时 ${t1}s，机器相关读数，不参与逐字节对账）"
  # 段数不足由**工件**判（下面那段 python），不由这里的 shell 变量判：见 GATE 文件里的 LEG 行。
  stop_chrome
  [ "${SPID:-0}" != 0 ] && { kill $SPID 2>/dev/null; wait $SPID 2>/dev/null; }
  [ "${PPID2:-0}" != 0 ] && { kill $PPID2 2>/dev/null; wait $PPID2 2>/dev/null; }
  SPID=0; PPID2=0
  return 0
}

cleanup() {
  # 只杀自己起的那几个 pid；别的 agent 的 Chrome / 服务器一律不动。
  # 看门狗也要在这里杀掉：脚本中途 die 时若留着它，它会在超时后拿一份早失效的
  # pid 表再跑一次 cleanup —— 那些 pid 号可能已被系统回收给别人。
  [ -n "${WD:-}" ] && kill "$WD" 2>/dev/null
  [ "${SPID:-0}" != 0 ] && kill $SPID 2>/dev/null
  [ "${PPID2:-0}" != 0 ] && kill $PPID2 2>/dev/null
  stop_chrome
  return 0
}
trap cleanup EXIT
# The watchdog redirects its fds: a background subshell inherits this script's stdout, and
# inside a pipeline it would hold the write end open long after the tests finished.
# WD= inside the subshell: cleanup kills the watchdog, and a watchdog that kills itself would
# abort its own TERM handler halfway and leave Chrome/servers behind.
# 十一条腿 × 两形态：拒盘腿三个真指针回合、续局腿一次真 Page.reload + 两遍整页启动、
# 跨引擎腿在页内开 20 张盘、canary 腿在页内重跑九次 produce ⇒ 每形态 11 次 playtest 起停。
( sleep ${WD_TIMEOUT:-2100}; echo "watchdog 到点：闸还没跑完" >&2; WD=; cleanup; exit 4 ) </dev/null >/dev/null 2>&1 &
WD=$!

cd "$HERE"
SHAPE_LIST="root prefix deployed"
[ "$CUSTOM" = 1 ] && SHAPE_LIST="deployed"
for shape in ${SHAPES:-$SHAPE_LIST}; do
  if [ "$shape" = deployed ] && [ -z "${DEPLOYED_URL:-}" ]; then
    echo
    echo "################ shape=deployed SKIPPED —— 没给 DEPLOYED_URL，这一跑**不**碰线上那一份。"
    echo "     线上形态不是"可选加分项"：它要求 https 首页与磁盘逐字节一致，而本地服务器永远能蒙对 root 形。"
    echo "     要跑它就一行：DEPLOYED_URL=https://z-biz-game.github.io/$REPO/ SHAPES=deployed bash tools/verify.sh"
    SHAPE_SKIPPED="$SHAPE_SKIPPED deployed"
    continue
  fi
  run_shape "$shape" || FAILED=1
done

kill $WD 2>/dev/null
# wait for it: otherwise bash's job control prints "Terminated: 15  ( sleep … )" on stderr
# right after, and a green run looks like it broke something.
wait $WD 2>/dev/null
WD=   # reaped: don't let the EXIT trap kill a pid number that may already belong to someone else
echo "loadavg（这一跑结束时）：$(sysctl -n vm.loadavg 2>/dev/null || cat /proc/loadavg)"
echo "chrome: $("$CHROME" --version 2>/dev/null) · node: $(node --version)"

# ---- 最终裁决：从工件读回来，不看这一行 shell 的 $? ---------------------------------------------------
# 每个形态都必须交回 $WANT_N 段、每段 rc 都必须为 0、每段的 rows 都必须 >0、fails 必须为 0；
# 少一段（脚本 die 在中途、腿名改名、Chrome 起不来）就是**少跑**，判红而不是判绿。
FAILED=${FAILED:-0}
python3 - "$GATE" "$WANT_N" "$SHAPE_SCORED" "$SHAPE_WANT" "$SHAPE_SKIPPED" <<'VERDICT'
import sys, re, os
gate, want_n, scored, want_shapes, skipped = sys.argv[1:6]
want_n = int(want_n); scored = int(scored); want_shapes = int(want_shapes)
lines = [l.rstrip('\n') for l in open(gate) if l.strip()]
legs = []
for l in lines:
    m = re.match(r'LEG (\S+) (\S+) rc=(\S+) rows=(\d+) fails=(\d+)', l)
    if m:
        legs.append(m.groups())
by_shape = {}
for shape, leg, rc, rows, fails in legs:
    by_shape.setdefault(shape, []).append((leg, rc, int(rows), int(fails)))
bad = []
for shape, items in by_shape.items():
    if len(items) != want_n:
        bad.append('形态 %s 只报回 %d/%d 段腿（悄悄少跑不能算绿）' % (shape, len(items), want_n))
    for leg, rc, rows, fails in items:
        if rc != '0':
            bad.append('%s/%s rc=%s' % (shape, leg, rc))
        if rows == 0:
            bad.append('%s/%s 交了 0 条断言 —— 0 样本的一行必须大声判 FAIL，不是判通过' % (shape, leg))
        if fails:
            bad.append('%s/%s %d 条 FAIL' % (shape, leg, fails))
missing = want_n * scored - len(legs)
if missing > 0:
    bad.append('总段数 %d，应为 %d 段（%d 形态 × %d 腿）——差 %d 段没交工件' % (len(legs), want_n * scored, scored, want_n, missing))
if scored == 0:
    bad.append('一个形态都没跑成（0 scored）——没有任何工件，不能绿')
print('scored %d of %d shapes（实际跑过并已判定的 / 清单里点的）；跳过：%s'
      % (scored, want_shapes, skipped.strip() or '无'))
for shape in sorted(by_shape):
    items = by_shape[shape]
    print('  %-9s legs %d/%d · 断言 %d 条 · FAIL %d' % (
        shape, len(items), want_n, sum(r for _, _, r, _ in items), sum(f for _, _, _, f in items)))
# 每条腿的 rc 还得**在它自己的工件里**再写一次 GATE_RC= —— 两份读数不一致就是工件在骗人。
for shape, leg, rc, rows, fails in legs:
    if rc == 'RUNBAD':
        continue
    art = os.path.join(os.path.dirname(gate), '%s-%s.log' % (shape, leg))
    want = None
    try:
        for l in open(art):
            m = re.match(r'GATE_RC=(\d+)', l.strip())
            if m:
                want = m.group(1)
    except OSError:
        want = None
    if want is None:
        bad.append('%s/%s 的腿工件里没有 GATE_RC 行：%s' % (shape, leg, art))
    elif want != rc:
        bad.append('%s/%s 汇总说 rc=%s，腿工件说 GATE_RC=%s —— 两把尺子不一样长' % (shape, leg, rc, want))
rc_out = 1 if bad else 0
for b in bad:
    print('  BAD ' + b)
print('GATE_RC=%d' % rc_out)
sys.exit(rc_out)
VERDICT
FINAL=$?
if [ "$FINAL" != "$FAILED" ]; then
  echo "  注意：包装脚本自己记的 FAILED=$FAILED 与工件读回的 GATE_RC=$FINAL 不一致 —— 以**工件**那份为准（裁决只认写进文件的那一位）。"
fi
# 部署集闸：ci.yml 早就在跑这两步，本地整闸以前一次都不跑。缺这一步就是「本地全绿、线上 404 自己的
# manifest / sw.js / 图标」这一整类坏法。它不碰 Chrome，也不读页面，纯查产物。
# 这一仓的出口不是 FAILED 而是读回工件的 FINAL，所以红必须并进 FINAL —— 否则块里红了、
# 横幅仍写 ALL GREEN、退出码仍是 0，正是静态审计看不见的那条假绿通道。
echo "=== deploy-set ==="
node tools/deploy-set.mjs; DS1=$?
node tools/deploy-set-selftest.mjs; DS2=$?
[ "$DS1" -eq 0 ] && [ "$DS2" -eq 0 ] || FINAL=1
echo "GATE_RC=$FINAL" >>"$GATE"
# 只报这一跑真的跑过的形态：SHAPES=root / DEPLOYED_URL 那种单形态跑，旧文案照样打印"两种 URL 形态"。
# 阴性自证也走同一条出口：故意改错期望时这一跑的 **rc 必须非 0**。
[ "$SABOTAGE" = 1 ] && echo "=== 阴性自证这一跑：期望被故意改错，上面必须有 FAIL 且**退出码非 0** ==="
[ "$FINAL" = 0 ] && echo "=== ALL GREEN（这一跑实际覆盖的 URL 形态：${SHAPE_RAN# }）===" || echo "=== FAILURES ABOVE（裁决读自 ${GATE}）==="
echo "工件：$GATE"
exit $FINAL
