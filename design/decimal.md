# decimal 設計提案（設計ゲート。実装はユーザー採用指示を待つ）

ステータス: **提案のみ（未実装）**。SPEC には現状「decimal は P1」（§8.6/§11/§14）としかないため、本マイルストーンは設計ゲートとする。採用後に実装・テスト・SPEC 反映を行う。

## 0. 設計原則（f64 の教訓 §8.6/§0.3 から）

M16 で確定した「**単一の数値表現＋バックエンド間の差分一致を最優先**」を decimal でも貫く:
- interp（Rust）、JS バックエンド、将来の WASM で **同一の表現・同一の演算結果** を達成することを最優先する。
- したがって「JS にネイティブがあるか」より「3バックエンドでビット一致しやすいか」を選定基準にする。

## 1. 表現の選択肢と推奨

| 案 | 形状 | interp(Rust) | JS | WASM | 評価 |
|---|---|---|---|---|---|
| A. 固定小数点（推奨） | `value = i128 のスケール済み整数`、固定 SCALE | i128（完全一致） | BigInt（完全一致） | i128（完全一致） | **ビット一致が容易**。範囲は SCALE 次第で固定 |
| B. 10進浮動小数点（decimal64/128相当） | mantissa + exponent | 自前実装 | 自前実装（BigInt+exp） | 自前実装 | 表現力は高いが正規化・丸めの一致が難しい |
| C. f64 を流用 | — | — | — | — | decimal の意味（正確さ）がなくなるため却下 |

**推奨: A. 固定小数点。SCALE = 18 固定。** `decimal値 = scaled / 10^18`。i128 の範囲は約 ±1.7e38 なので、表現可能な decimal は約 ±1.7e20（SCALE=18 のとき）。金額・計測値には十分で、もし動的レンジが必要になったら後日 B を別型として追加できる（P5 検討事項と同じく段階的に）。

- JS 側は BigInt（任意精度）なのでオーバーフローしない一方、Rust i128 はオーバーフローする。**一致させるため、両バックエンドで同じ絶対値上限 `DEC_MAX = floor(i128::MAX / 10^18)` を検査し、超えたら同一の実行時エラー**（§8.6 のバックエンド中立エラー表に追加）を出す。BigInt でも同じ境界検査を行う。
- WASM(P4/P5) では i128 があるので同一コードで一致する。

## 2. 構文・型・演算

- **リテラル**: 既存の `1.5` は number(f64) のまま（後方互換）。decimal リテラルは **接尾辞 `d`**: `1.50d`、`0d`、`-3.25d`。lexer に Number 後続の `d` を見たら Decimal トークンにするだけで、既存構文と衝突しない。
- **型名**: `decimal`。`type ::= ... | 'decimal'`（§3.3 に追記）。`(Array decimal)`、`(Result decimal string)` 等もそのまま使える。
- **演算の多重定義**: `+ - * / < <= > >= =` を「両引数が同じ型（number 同士 / decimal 同士）のときだけ」許可に拡張。混在（number と decimal）は **type-mismatch**（暗黙変換は非目標なので明示変換のみ）。実装は unify に「両辺が decimal なら decimal、両辺 number なら number、混在は失敗」の規則を追加する形。
- **`=`（構造的等価）**: decimal 同士はスケール済み整数の一致（固定 SCALE なので正規化不要）→ i128/BigInt の等価で全バックエンド一致。
- **印字（§11.6）**: `str` / REPL 印字は **小数点以下ちょうど SCALE 桁** の平書き（例: `1.500000000000000000`）。指数表記にしない。決定的で全バックエンド一致。

## 3. number との相互変換（明示のみ。暗黙変換はしない）

stdlib に最小セットで追加（§11 の表に追記）:
- `to-dec : (fn (number) : decimal)` — f64 の最短往復表現（Rust Display / JS String は桁は同一で表記だけ差）をパースし、SCALE で **round-half-away-from-zero** に丸める。桁が一致するので全バックエンド同一結果。
- `to-num : (fn (decimal) : number)` — `scaled as f64 / 10^18`。IEEE の正しく丸められた除算で、Rust/JS とも一致。

## 4. 演算の丸め規則（決定性のため全て明文化）

スケール済み整数を `a, b`（SCALE=18）、`S = 10^18` とする。
- `+` `-`: 整数の加減算。絶対値が `DEC_MAX*S` を超えたら実行時エラー `decimal-overflow`（§8.6 表に追加）。一致。
- `*`: `round_half_away(a*b / S)`。trunc 除算 + 剰余で判定（`2|r| >= |b|` なら切り上げ方向へ）。i128/BigInt とも同一に計算できる。
- `/`: `b == 0` なら実行時エラー `decimal-division-by-zero`（number の `(/ 1 0)=Infinity` とは異なることを明記）。他は `round_half_away(a*S / b)`。
- 比較 `< <= > >=`: スケール済み整数の比較。一致。
- `round-half-away-from-zero` は「0 から離れる方向に .5 を切り上げ」（負なら -0.5 → -1）。金融系で標準的で、i128 と BigInt の両方で `trunc + 2|r| >= |b|` として**完全一致**に実装できる。

## 5. 差分テスト方針（interp vs JS で同一の丸め結果を得る）

- fixed-point の整数演算は i128（Rust）と BigInt（JS）で**完全一致**するので、丸めも同一アルゴリズム（trunc+剰余）なら結果はビット一致する。
- `tests/fixtures/decimal-edge.lts`（新規）に add/sub/mul/div（.5 ちょうどの丸め、負の丸め、オーバーフロー、0 除算エラー、比較、`=`、to-dec/to-num 往復、印字）の example を書き、既存の `assert_diff`（interp vs js/mock）で一致を検証する。
- 生成 JS の golden（`decimal-edge.js`）も追記し、BigInt lowering（`150n` 等）を固定する。
- prop の forall で decimal を生成可能にするなら、gen はスケール済み整数を範囲内でランダム生成＋境界 {0, ±1, ±DEC_MAX} とする（M22 の gen 拡張として別途).

## 6. JS lowering（§12.4）と WASM

- decimal値 → JS は **BigInt のスケール済み整数**。リテラル `1.50d` はコンパイル時に `1500000000000000000n` へ変換。演算は BigInt の +,-,*,/（truncating）＋剰余で丸め。印字は SCALE 位置に小数点を入れる整形関数（runtime.js に置かず生成コードのローカルヘルパ `$print_dec` 等、§11.6 と同じ方針）。
- `to-num` → `Number(scaled) / 1e18`。`to-dec` → number の文字列表現をパースしてスケール化（BigInt でパースして丸め）。
- WASM: i128 演算で同一コード。

## 7. SPEC 反映ポイント（採用後）

§3.3（type に decimal）、§3.5/字句（`d` 接尾辞リテラル）、§11（stdlib 表に to-dec/to-num と演算子の多重定義規則）、§11.6（印字: SCALE 桁固定の平書き）、§8.6（実行時エラーに decimal-overflow / decimal-division-by-zero をバックエンド中立に追加）、§12.4（lowering: BigInt スケール済み整数）、§14（P1 行の decimal を完了へ）、§0.3 追補リスト。

## 8. 未決（採用時に詰める）

- SCALE=18 でよいか（範囲 ±1.7e20 でよいか）。代替: SCALE=9（範囲 ±1.7e29、小数9桁）など。
- 接尾辞は `d` でよいか（`m` 等の別案）。
- 演算子の多重定義 vs `d+ d- d* d/` の専用演算子。
- オーバーフロー時: 実行時エラー vs 飽和（§8.6 方針と揃えてエラー推奨）。
