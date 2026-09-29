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

echo
if [ "$fail" -eq 0 ]; then
  echo 'WIRING-CHECK PASS'
else
  echo 'WIRING-CHECK FAIL'
fi
exit "$fail"
