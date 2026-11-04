#!/usr/bin/env bash
# lists-smoke.sh — lists CLI の実用確認スクリプト（S1..S20）
# 使い方: bash scripts/lists-smoke.sh   （リポジトリルートからでも scripts/ からでも動く）
# 終了コード: 全 PASS なら 0、1つでも FAIL なら 1。結果は "SMOKE: <pass>/20" で表示。
set -u
cd "$(dirname "$0")/.."

BIN=target/debug/lists
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

pass=0
fail=0
ok() { pass=$((pass + 1)); echo "PASS $1"; }
ng() { fail=$((fail + 1)); echo "FAIL $1 -- $2"; }
# check <S番号> <説明> <終了コード0でPASS> <失敗時メッセージ>
check() {
  if [ "$3" -eq 0 ]; then ok "S$1 $2"; else ng "S$1 $2" "$4"; fi
}

cargo build -q || { echo "build failed"; exit 1; }

F=tests/fixtures

# S1: 正常系 compile — exit 0・stdout は []・.js/.js.map 生成
out=$($BIN compile $F/money.lts --out "$TMP/o1"); code=$?
[ "$code" -eq 0 ] && [ "$out" = "[]" ] && [ -f "$TMP/o1/money.js" ] && [ -f "$TMP/o1/money.js.map" ] && [ -f "$TMP/o1/runtime.js" ]
check 1 "compile money.lts: exit 0, stdout [], js+map+runtime.js 生成" $? "code=$code out=$out files=$(ls "$TMP/o1" 2>/dev/null | tr '\n' ' ')"

# S2: source map の sources が .lts を指す
grep -q '"sources"' "$TMP/o1/money.js.map" && grep -q 'money\.lts' "$TMP/o1/money.js.map"
check 2 "source map が .lts を指す" $? "$(cat "$TMP/o1/money.js.map" 2>/dev/null | head -c 120)"

# S3: name-convention — camelCase の defn 名が exit 1 + kind name-convention + fix.template "bad-name"
printf '(export badName)\n(defn badName (x : number) : number x)\n' > "$TMP/bad-name.lts"
out=$($BIN compile "$TMP/bad-name.lts" --out "$TMP/o3"); code=$?
if [ "$code" -eq 1 ] && printf '%s' "$out" | grep -q '"kind":"name-convention"' && printf '%s' "$out" | grep -q '"template":"bad-name"'; then
  rc=0
else
  rc=1
fi
check 3 "name-convention: exit 1 + kind name-convention + fix.template bad-name" $rc "code=$code out=$out"

# S4: パースエラー — exit 1 + kind parse-error
out=$($BIN compile $F/broken.lts --out "$TMP/o4"); code=$?
[ "$code" -eq 1 ] && printf '%s' "$out" | grep -q '"kind":"parse-error"'
check 4 "broken.lts: exit 1 + parse-error" $? "code=$code out=$out"

# S5: 網羅性エラー — exit 1 + non-exhaustive
out=$($BIN compile $F/stock.lts --out "$TMP/o5"); code=$?
[ "$code" -eq 1 ] && printf '%s' "$out" | grep -q '"kind":"non-exhaustive"'
check 5 "stock.lts: exit 1 + non-exhaustive" $? "code=$code out=$out"

# S6: エフェクト違反 — exit 1 + effect-violation
out=$($BIN compile $F/effects.lts --out "$TMP/o6"); code=$?
[ "$code" -eq 1 ] && printf '%s' "$out" | grep -q '"kind":"effect-violation"'
check 6 "effects.lts: exit 1 + effect-violation" $? "code=$code out=$out"

# S7: fmt は in-place で書き換える — exit 0 + stdout []
cp $F/money.lts "$TMP/fmt1.lts"
before=$(cat "$TMP/fmt1.lts")
out=$($BIN fmt "$TMP/fmt1.lts"); code=$?
after=$(cat "$TMP/fmt1.lts")
[ "$code" -eq 0 ] && [ "$out" = "[]" ] && [ "$before" != "$after" ]
check 7 "fmt: exit 0 + [] + in-place 変更" $? "code=$code out=$out"

# S8: fmt は冪等
out=$($BIN fmt "$TMP/fmt1.lts"); code=$?
[ "$code" -eq 0 ] && [ "$after" = "$(cat "$TMP/fmt1.lts")" ]
check 8 "fmt: 冪等" $? "code=$code"

# S9: パースエラーのファイルは fmt で変更しない — exit 1
cp $F/broken.lts "$TMP/fmt2.lts"
before=$(cat "$TMP/fmt2.lts")
out=$($BIN compile "$TMP/fmt2.lts" >/dev/null 2>&1; $BIN fmt "$TMP/fmt2.lts"); code=$?
[ "$code" -eq 1 ] && [ "$before" = "$(cat "$TMP/fmt2.lts")" ]
check 9 "fmt: パースエラー時は exit 1 + ファイル不変" $? "code=$code"

# S10: REPL eval は ok:true を返す
printf '{"op":"eval","src":"(defn three () : number 3)"}\n' | $BIN repl | grep -q '"ok":true'
check 10 "repl eval: ok:true" $? "$(printf '{"op":"eval","src":"(defn three () : number 3)"}\n' | $BIN repl)"

# S11: REPL type-of は型を返す
printf '{"op":"type-of","src":"(+ 1 2)"}\n' | $BIN repl | grep -q '"type":"number"'
check 11 "repl type-of: number" $? "$(printf '{"op":"type-of","src":"(+ 1 2)"}\n' | $BIN repl)"

# S12: REPL test は example を実行して pass を返す
printf '{"op":"eval","src":"(example (+ 1 2) => 3)"}\n{"op":"test"}\n' | $BIN repl | grep -q '"pass":true'
check 12 "repl test: example pass" $? "$(printf '{"op":"eval","src":"(example (+ 1 2) => 3)"}\n{"op":"test"}\n' | $BIN repl)"

# S13: --backend js を明示しても exit 0
out=$($BIN compile $F/money.lts --out "$TMP/o13" --backend js); code=$?
[ "$code" -eq 0 ] && [ "$out" = "[]" ]
check 13 "compile --backend js: exit 0" $? "code=$code out=$out"

# S14: 未知バックエンドは exit 2
$BIN compile $F/money.lts --out "$TMP/o14" --backend bogus >/dev/null 2>&1; code=$?
[ "$code" -eq 2 ]
check 14 "compile --backend bogus: exit 2" $? "code=$code"

# S15: import-not-found — exit 1 + kind import-not-found
out=$($BIN compile $F/mod-missing.lts --out "$TMP/o15"); code=$?
[ "$code" -eq 1 ] && printf '%s' "$out" | grep -q '"kind":"import-not-found"'
check 15 "mod-missing.lts: exit 1 + import-not-found" $? "code=$code out=$out"

# S16: 複数ファイル compile — exit 0 + cart.js が money.js を import
out=$($BIN compile $F/money.lts $F/cart.lts --out "$TMP/o16"); code=$?
[ "$code" -eq 0 ] && grep -q 'money\.js' "$TMP/o16/cart.js"
check 16 "money+cart: exit 0 + cart.js が money.js を import" $? "code=$code out=$out"

# S17: 生成JSを Node で実行 — money.js の example が ok
node "$TMP/o1/money.js" > "$TMP/n17.txt" 2>&1; code=$?
[ "$code" -eq 0 ] && grep -q ': ok' "$TMP/n17.txt"
check 17 "node money.js: example ok" $? "code=$code out=$(head -c 120 "$TMP/n17.txt")"

# S18: 生成JSを Node で実行 — cart.js（money.js と同階層）も ok
node "$TMP/o16/cart.js" > "$TMP/n18.txt" 2>&1; code=$?
[ "$code" -eq 0 ] && grep -q ': ok' "$TMP/n18.txt"
check 18 "node cart.js: example ok" $? "code=$code out=$(head -c 120 "$TMP/n18.txt")"

# S19: 末尾再帰 1e6 が Node でも定数スタックで成功
out=$($BIN compile $F/tail-self.lts --out "$TMP/o19"); code=$?
[ "$code" -eq 0 ] && node "$TMP/o19/tail-self.js" >/dev/null 2>&1
check 19 "tail-self.lts: compile+node 実行 exit 0（1e6 末尾再帰）" $? "compile code=$code"

# S20: stdlib-edge.lts の全 example（70件）が interp/JS の双方で ok
out=$($BIN compile $F/stdlib-edge.lts --out "$TMP/o20"); code=$?
n_ok=0
if [ "$code" -eq 0 ]; then
  node "$TMP/o20/stdlib-edge.js" > "$TMP/n20.txt" 2>&1 && n_ok=$(grep -c ': ok' "$TMP/n20.txt" || true)
fi
[ "$code" -eq 0 ] && [ "$n_ok" -eq 70 ]
check 20 "stdlib-edge.lts: 70/70 examples ok in node" $? "compile code=$code ok=$n_ok"

echo "SMOKE: $pass/20"
[ "$fail" -eq 0 ]
