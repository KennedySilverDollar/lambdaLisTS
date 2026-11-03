# lambdaLisTS

λ LisTS（SPEC.md v0.2, P0）のプロトタイプ実装です。レキサ・パーサ・脱糖・双方向型検査・網羅性検査・エフェクト/モジュール検査・インタープリタ・JS バックエンド・CLI/REPL/フォーマッタを含みます。

## セットアップ

```sh
npm install
npm run build    # tsc → dist/（source map 付き）
```

## テスト

```sh
npm test         # vitest run（単体 + 受け入れ T1–T9、全203件）
```

## 使い方

CLI は `npm run cli -- <command> ...`（ビルド後は `node dist/tools/cli.js <command> ...`）です。

### compile — 検査 + JS 生成（§10.5）

```sh
npm run cli -- compile test/fixtures/money.lts test/fixtures/cart.lts --out /tmp/out
```

- 診断は `Diagnostic[]` の JSON を stdout に出力（エラーなしは `[]`）。exit code は 0 / 1。
- `--out <dir>` に `<file>.js` と `<file>.js.map`、 plus `runtime.js` を一度だけ出力。未指定時はソースと同じ場所。
- 生成した JS はそのまま Node で実行できます（example を評価して結果を表示）:

```sh
node /tmp/out/cart.js
# example 0: ok {"tag":"Err","value":{"tag":"EmptyCart"}}
```

### fmt — 一意フォーマット（in-place、§10.3）

```sh
npm run cli -- fmt test/fixtures/money.lts
```

2スペース字下げ、`defn`/`match`/`do`/`cond`/`example` は要素ごとに改行、コメントは保持されます。冪等（`fmt(fmt(x)) === fmt(x)`）です。

### repl — JSON Lines REPL（§10.1）

```sh
npm run cli -- repl
```

stdin から1行1JSON、stdout に1行1JSON で応答します。

```json
{"id": 1, "op": "eval", "src": "(defn add (a : number) (b : number) : number (+ a b))"}
{"id": 2, "op": "test"}
{"id": 3, "op": "prop", "name": "add-money commutative"}
{"id": 4, "op": "reload", "file": "./test/fixtures/cart.lts"}
{"id": 5, "op": "type-of", "src": "add"}
{"id": 6, "op": "quit"}
```

- `eval`: 定義を追加し、定義名と型（§6.2 正規表記）を返します。診断がある場合は `ok: false` + `errors`。
- `test`: ロード済みの全 `example` を評価し、期待値と構造的等価（§8.3）で比較した結果を返します。
- `prop`: P0 では評価せず `unsupported-in-p0` エラーを返します（P1）。
- `reload`: ファイルを再読み込みして再検査します。
- `type-of`: 式の型を §6.2 の正規表記で返します。
- `quit`: 終了します。

## λ LisTS の書き方（抜粋）

```lisp
(type Money (obj (amount : number) (currency : string)))

(export add-money zero)

(defn zero () : Money
  (obj (amount 0) (currency "JPY")))

(defn add-money (a : Money) (b : Money) : (Result Money string)
  (if (= a.currency b.currency)
    (ok (obj (amount (+ a.amount b.amount)) (currency a.currency)))
    (err (str-concat "currency mismatch: " a.currency " vs " b.currency))))

(example (add-money (obj (amount 1) (currency "JPY"))
                    (obj (amount 2) (currency "JPY")))
  => (ok (obj (amount 3) (currency "JPY"))))
```

構文の full な定義は SPEC.md §2–§3、標準ライブラリは §11 を参照してください。サンプルは `test/fixtures/`（付録A: money.lts / cart.lts、付録B: broken/effects/stock/cycle）にあります。

## P0 の制限

- `defn!`（エフェクト関数）は検査のみ受理。JS 生成・実行は P1（生成時にエラー）。
- `prop` の評価（反例生成・縮小）は P1。構文と型検査のみ行います。
- 非末尾再帰のスタック深さは実装依存です（実測値は docs/README.md に記載）。

##構成

```
src/
  lexer/      token.ts, lexer.ts            §2 字句
  parser/     ast.ts, parser.ts             §3 構文
  core/       ir.ts, desugar.ts             §4/§5 脱糖 → Core IR
  types/      type.ts, unify.ts, stdlib.ts, check.ts, exhaustive.ts   §6/§11 型検査
  effects/    check.ts                      §7 エフェクト検査
  modules/    resolver.ts                   §3.8 モジュール解決
  interp/     value.ts, env.ts, stdlib.ts, eval.ts   §8 インタープリタ
  backend/    runtime.ts, sourcemap.ts, js.ts        §12 JS バックエンド
  tools/      cli.ts, repl.ts, fmt.ts       §10 CLI / REPL / fmt
  diagnostic.ts                             §9 診断モデル
test/         単体テスト + fixtures/ + acceptance/（受け入れ T1–T9）
docs/         README.md（詳細・実測値・既知の差異）
```

## 受け入れテスト（SPEC.md §13）

`npm test` に T1〜T9 が含まれます（全203件緑）:

| テスト | 内容 | 状態 |
|---|---|---|
| T1 | 純粋関数 + Result（add-money の JS 実行値） | ✅ |
| T2 | 網羅性検査（stock.lts の non-exhaustive + fix） | ✅ |
| T3 | do の早期リターン（Err なら total を呼ばない） | ✅ |
| T4 | モジュール（import 実行 / cycle エラー） | ✅ |
| T5 | パーサ回復（broken.lts） | ✅ |
| T6 | エフェクト違反検査（effects.lts、検査のみ） | ✅ |
| T7 | インタープリタと JS バックエンドの差分一致 | ✅ |
| T8 | source map（スタックが .lts 行・元関数名を指す） | ✅ |
| T9 | REPL の JSON 往復（eval/test/type-of、prop は unsupported） | ✅ |

詳細な説明・既知の差異は [docs/README.md](docs/README.md) を参照してください。

## Rust 版（P0 移植 — M0〜M10 完了）

Rust 版コンパイラはルートの `Cargo.toml` / `src/*.rs` にあります（GUIDE.md §4 の構成）。TypeScript 版（上）と同じ SPEC.md v0.2 (P0) を実装対象にしています。

### ビルド・テスト

```sh
cargo build                              # 単一バイナリ `lists` を生成（外部ランタイム不要）
cargo test                               # 全テスト（162件: lib 137 + acceptance 7 + golden 6 + backend 6 + tools 5 + smoke 1）
cargo clippy --all-targets -- -D warnings   # 警告ゼロを維持
UPDATE_SNAPSHOTS=1 cargo test            # tests/golden/ のスナップショットを再生成（GUIDE §6）
```

生成JSの実行検証（T1/T4/T7/T8）には Node.js >= 20 が必要です（テスト内で `node` を呼び出します）。

### 使い方（§10.5、TS 版と同じ semantics）

```sh
cargo run -- compile tests/fixtures/money.lts tests/fixtures/cart.lts --out /tmp/out   # 診断は Diagnostic[] JSON を stdout、exit 0/1
node /tmp/out/cart.js                                                                    # 生成JSを実行（example を検証）: example 0: ok {"tag":"Err","value":{"tag":"EmptyCart"}}
cargo run -- fmt tests/fixtures/money.lts                                                # in-place 一意フォーマット（冪等）
cargo run -- repl                                                                        # JSON Lines REPL（§10.1）
```

```json
{"id": 1, "op": "eval", "src": "(defn add (a : number) (b : number) : number (+ a b))"}
{"id": 2, "op": "test"}
{"id": 3, "op": "prop", "name": "add-money commutative"}
{"id": 5, "op": "type-of", "src": "add"}
{"id": 6, "op": "quit"}
```

### 構成（GUIDE.md §4）

```
Cargo.toml          edition 2021 / serde(derive+rc), serde_json, thiserror, clap(derive), sourcemap
src/
  main.rs           CLI エントリ（clap: compile / fmt / repl）
  lib.rs            pub mod 宣言（#![forbid(unsafe_code)]）
  span.rs           Span（バイト位置 + 1始まり line/Unicodeスカラ col）
  diagnostic.rs     Diagnostic/Patch/DiagKind（serde JSON）、AST パスヘルパー（§10.2）
  token.rs lexer.rs §2 字句（最長一致・コメントは trivia・error トークン）
  ast.rs parser.rs  §3 構文（全ノードに span+trivia、ベストエフォート回復 §9.4）
  ir.rs desugar.rs  §5 Core IR と §4 脱糖（決定的）
  types.rs unify.rs check.rs stdlib.rs exhaustive.rs   §6/§11 型検査（双方向・unify・網羅性）
  effects.rs resolver.rs                               §7 エフェクト検査・§3.8 モジュール解決
  value.rs eval.rs  §8 Value/インタープリタ（do 早期リターン・呼び出し統計・深さ上限）
  emit.rs runtime.rs sourcemap_out.rs backend/runtime.js  §12 JS 生成 + source map v3 + runtime.js
  fmt.rs repl.rs    §10.3 フォーマッタ / §10.1 JSON Lines REPL
tests/
  smoke.rs golden.rs backend.rs tools.rs     統合テスト（golden は tests/golden/）
  acceptance/       T1–T7 受け入れ（diff.rs は interp と node の差分一致）
  fixtures/         付録A/B + mod-*/cart-spy の .lts
```

### 進捗（マイルストーン）

| M | 内容 | 状態 |
|---|---|---|
| M0 | スキャフォールド（Cargo + モジュールスタブ + CLI 骨格） | ✅ |
| M1 | レキサ（§2） | ✅ |
| M2 | パーサ（§3、回復 §9.4） | ✅ |
| M3 | 脱糖 Surface → Core IR（§4/§5） | ✅ |
| M4 | 双方向型検査（§6.1–6.4、§11 stdlib） | ✅ |
| M5 | 網羅性検査（§6.5、non-exhaustive/redundant-arm + fix） | ✅ |
| M6 | エフェクト検査（§7）・モジュール解決（§3.8） | ✅ |
| M7 | Core IR インタープリタ（§8、呼び出し統計・深さ上限） | ✅ |
| M8 | JS コード生成 + source map v3 + runtime.js（§12） | ✅ |
| M9 | CLI / REPL / fmt（§10） | ✅ |
| M10 | interp↔JS 差分ハーネス（T7）＋ 受け入れ T1–T7 | ✅ |

### 受け入れテスト（Rust 版、SPEC §13）

| テスト | 内容 | 状態 |
|---|---|---|
| T1 | 純粋関数 + Result（add-money の JS 実行値） | ✅ tests/acceptance |
| T2 | 網羅性検査（stock.lts non-exhaustive + fix、診断JSONゴールデン） | ✅ tests/acceptance |
| T3 | do 早期リターン（total 未呼び出し: interp 統計 + JS スパイ） | ✅ tests/acceptance |
| T4 | モジュール（import 型検査/実行一致、cycle エラー） | ✅ tests/acceptance |
| T5 | パース回復（broken.lts） | ✅ tests/acceptance |
| T6 | エフェクト違反（effects.lts、検査のみ + fix） | ✅ tests/acceptance |
| T7 | インタープリタと JS バックエンドの差分一致 | ✅ tests/acceptance/diff.rs |
| T8 | source map（深い再帰のスタックが .lts 行を指す） | ✅ tests/backend.rs |
| T9 | REPL JSON 往復（ゴールデン） | ✅ tests/tools.rs |

### 既知の制限（P0 の範囲内）

- `defn!` は検査のみ受理（JS 生成時は `unsupported-in-p0` エラー、§7.5）。`prop` 評価も P1（REPL は `unsupported-in-p0` を返す）。
- Rust インタープリタの再帰深さ上限は `src/eval.rs` の `MAX_CALL_DEPTH = 10000` です（SPEC §8.5）。上限超過時はパニックせず `internal-error` を返します。
- 生成 JS の number は IEEE754 binary64（Rust `f64` と同一、§8.6）。`(/ 1 0)` は Infinity、`(/ 0 0)` は NaN です。
