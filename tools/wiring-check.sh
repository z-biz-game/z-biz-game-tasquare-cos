#!/usr/bin/env bash
# ci.yml 的 check job 里那两段"边界门"住在这里，而不是住在 workflow 的 inline run: 里。
#
# 为什么要搬家：只存在于 CI 的门迟早红得莫名其妙 —— 兄弟仓第一次 CI 红就是栽在一条本机跑不到的
# 边界 grep 上，于是那条门被当场放宽（那才是真正的损失）。现在 ci.yml 调这个脚本，本机的
# `npm run ci` 也调它，**一条门只有一份定义**，改哪儿都同步，红在哪儿本机一条命令就能复现。
#
#   bash tools/wiring-check.sh
set -uo pipefail
cd "$(dirname "$0")/.."
fail=0

echo '[1 js/ 不许 import tools/]'
# 分层不变量：js/ 要发给浏览器，tools/ 不发。运行时模块 import tools/ 要么是线上 404，
# 要么是拿门禁代码当产品代码 —— 那下面任何一道闸都不再是"出货的那份代码"。
# 正则是 **import/export 形状**，不是"文件里提一句 tools/ 就算命中"：本仓引擎注释合法地写着
# tools/balance.mjs、tools/rule-test.mjs（rules.js 的旋钮出处段就是其中之一），
# 宽正则会把注释判成分层破坏。
if grep -rnE "(import|export)[^;]*from '[^']*tools/" js/; then
  echo '  FAIL 运行时模块（js/）去够了 tools/ —— 分层又倒了'
  fail=1
else
  echo '  ok   js/ 里没有任何 import/export 指向 tools/'
fi

echo '[2 入口接线：页面 → app → game → engine]'
# 本仓首页**没有 canvas**（`grep -c canvas index.html` 实测 0）：盘是 DOM 格
# （#board[role=grid] > .cell[data-i]），所以兄弟仓那条 `grep -q '<canvas'` 在这里必然红，
# 抄过来只是给 CI 加一条与游戏无关的死步骤。下面每条都指向本仓真实的接线。
while IFS='|' read -r pat file; do
  [ -z "$pat" ] && continue
  if grep -qF -- "$pat" "$file"; then
    echo "  ok   $pat  <- $file"
  else
    echo "  MISS $pat  <- $file"
    fail=1
  fi
done <<'EOF'
id="board"|index.html
role="grid"|index.html
js/ui/app.js|index.html
css/style.css|index.html
./game.js|js/ui/app.js
../engine/rules.js|js/ui/app.js
CLAUSE_TEXT|js/ui/app.js
SOURCE_QUOTE|js/ui/app.js
../engine/generate.js|js/ui/game.js
TIERS|js/ui/game.js
pencilSolve|js/ui/game.js
countSolutions|js/ui/game.js
verify|js/ui/game.js
EOF

echo '[3 workflow manifest：注释里承诺的步骤必须真的存在]'
# 这一段的由来是今天真犯过的错：pages.yml 的注释写着版本三元组
# `configure-pages@v5 / upload-pages-artifact@v3 / deploy-pages@v4`，实际步骤却只落了最后一个 ——
# 那是一条"run 报绿而工件里什么都没上传"的形状，而且**注释越像证据越危险**。
# 所以把"manifest 里应当存在的那些行"变成机器断言：删掉一步、或把这份工作流换成不再调本脚本，
# 这里立刻红。（ci.yml 那一半同样有用：本文件如果不再被 CI 调用，这几段门就退回成死代码。）
m=0
chk() {  # chk <文件> <必须出现的行形状> <说明>
  if grep -qF -- "$2" "$1"; then
    echo "  ok   $3"
  else
    echo "  MISS $1 里没有「$2」 —— $3"
    m=1
  fi
}
chk .github/workflows/pages.yml 'actions/configure-pages@v5'    'Pages 得先被 configure-pages 绑定 environment'
chk .github/workflows/pages.yml 'actions/upload-pages-artifact@v3' '工件必须真的被上传（缺它 = 部署悄悄停止部署）'
chk .github/workflows/pages.yml 'actions/deploy-pages@v4'       '部署那一步得在'
chk .github/workflows/pages.yml 'path: _site'                   '上传的必须是拼出来的 _site'
chk .github/workflows/pages.yml 'test ! -e _site/tools'         '工件边界：门禁代码不许上线'
chk .github/workflows/ci.yml    'node tools/rule-test.mjs'      'CI 跑 rule-test'
chk .github/workflows/ci.yml    'node tools/counter-test.mjs'   'CI 跑 counter-test'
chk .github/workflows/ci.yml    'node tools/pencil-test.mjs'    'CI 跑 pencil-test'
chk .github/workflows/ci.yml    'node tools/balance.mjs'        'CI 跑 balance'
chk .github/workflows/ci.yml    'bash tools/wiring-check.sh'    'CI 跑本脚本（否则这几段门是死代码）'
chk .github/workflows/ci.yml    'bash tools/verify.sh'          'CI 跑浏览器闸'
[ "$m" -eq 0 ] || fail=1

echo '[4 工件形状：真的把 _site 拼一遍再验边界]'
# 站点内容只有 index.html + css/ + js/。tools/、server.cjs、package.json 一旦上线，
# "线上跑的正是这个仓"这句话就开始包含门禁代码，而浏览器闸对部署形态只看得到页面 ——
# 泄漏不会被任何一条腿发现。_site 在 .gitignore 里，这里用一次性目录，不留在仓里。
SITE=$(mktemp -d)
cp index.html "$SITE/"
cp -r css js "$SITE/"
bnd=0
for bad in tools server.cjs package.json docs; do
  if [ -e "$SITE/$bad" ]; then echo "  MISS 工件里有 $bad"; bnd=1; fi
done
for need in index.html css/style.css js/ui/app.js js/engine/generate.js; do
  if [ ! -f "$SITE/$need" ]; then echo "  MISS 工件里少了 $need"; bnd=1; fi
done
rm -rf "$SITE"
if [ "$bnd" -eq 0 ]; then
  echo '  ok   工件只有页面够得到的那份：index.html + css/ + js/（门禁代码在门外）'
else
  fail=1
fi
echo '[5 本地入口：npm run ci 够得到 ci.yml 的每一个 tools 门禁]'
# 第 [3] 段钉的是"CI 跑的那些门在 workflow 里还在"，它管不到本机。这一段钉另一半：把 package.json
# 的 scripts.ci 顺着 `npm run X` 一层层展开，ci.yml 现读出来的每个门禁都得被够到。清单不手抄——
# 手抄的清单会先烂：README 以前写着 `npm run ci` = 本机跑通 check job，而那条命令其实只到 test 为止，
# deploy-set / deploy-set:selftest / verify 三步从来不在里面（漏掉的那几步只在 CI 红，本地全绿）。
node --input-type=module - <<'NODEEOF' || fail=1
import { readFileSync } from 'node:fs';
const lines = readFileSync('.github/workflows/ci.yml', 'utf8').split('\n');
const cmds = [];
let block = -1;
for (const l of lines) {
  const r = /^(\s*)(?:-\s+)?run:\s*(.*)$/.exec(l);
  if (r) {
    const body = r[2].trim();
    if (body === '' || body === '|') { block = r[1].length; continue; }
    cmds.push(body); block = -1; continue;
  }
  if (block >= 0) {
    const ind = l.match(/^\s*/)[0].length;
    if (l.trim() !== '' && ind > block) { cmds.push(l.trim()); continue; }
    block = -1;
  }
}
const GATE = /(?:node|bash|sh) (tools\/[\w.-]+)/g;
const gates = [...new Set(cmds.flatMap((c) => [...c.matchAll(GATE)].map((m) => m[1])))];
const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts || {};
const seen = new Set(); const reach = new Set();
const walk = (name) => {
  if (seen.has(name)) return;
  seen.add(name);
  const body = scripts[name] || '';
  for (const m of body.matchAll(GATE)) reach.add(m[1]);
  for (const m of body.matchAll(/npm\s+run\s+([\w:-]+)/g)) walk(m[1]);
  for (const m of body.matchAll(/npm\s+(test|start)\b/g)) walk(m[1]);
};
walk('ci');
let bad = 0;
if (gates.length < 6 || reach.size < 6) {
  console.log(`  MISS 两边至少得各读出 6 个门禁（ci.yml 现读 ${gates.length} · npm run ci 展开 ${reach.size}）—— 解析器空转不给绿`);
  bad = 1;
}
const miss = gates.filter((g) => !reach.has(g));
for (const g of gates) console.log(`  ${reach.has(g) ? 'ok  ' : 'MISS'} ${g}`);
if (miss.length) {
  console.log(`  MISS ci.yml 跑到的这 ${miss.length} 个门禁，npm run ci 够不到：${miss.join(' ')}`);
  bad = 1;
} else if (!bad) {
  console.log(`  ok   ci.yml 现读 ${gates.length} 个门禁，npm run ci（展开 ${[...seen].sort().join(' → ')}）全部够到`);
}
process.exit(bad);
NODEEOF

echo
if [ "$fail" -eq 0 ]; then
  echo 'WIRING-CHECK PASS'
else
  echo 'WIRING-CHECK FAIL'
fi
exit "$fail"
