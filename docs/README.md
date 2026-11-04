# λ LisTS — P0 プロトタイプ

SPEC.md v0.2 (P0) に基づく λ LisTS の P0 実装。レキサ → パーサ → 脱糖 (Core IR) → 双方向型検査 → 網羅性検査 → エフェクト/モジュール検査 → インタープリタ → JS バックエンド → CLI/REPL/フォーマッタまでを含む。

## ビルド

```sh
cargo build        # バイナリは target/debug/lists
```

## テスト

```sh
cargo test         # 全テスト: 単体 + 受け入れ T1–T9
```

## 実行

```sh
# コンパイル（診断は Diagnostic[] の JSON で stdout、exit 0/1。--out に .js/.js.map と runtime.js を出力）
cargo run -- compile tests/fixtures/money.lts tests/fixtures/cart.lts --out /tmp/out
node /tmp/out/cart.js          # example を実行して結果を表示

# フォーマット（in-place）
cargo run -- fmt tests/fixtures/money.lts

# REPL（JSON Lines: 1行1JSON in → 1行1JSON out）
cargo run -- repl
{"id": 1, "op": "eval", "src": "(defn add (a : number) (b : number) : number (+ a b))"}
{"id": 5, "op": "type-of", "src": "add"}
{"id": 2, "op": "test"}
{"id": 3, "op": "prop", "name": "x"}
{"id": 6, "op": "quit"}
```

op: `eval` / `test` / `prop` / `reload` / `type-of` / `quit`（§10.1）。

## P0 の制限（P1以降）

- `defn!` はパース・型付け・エフェクト検査のみ受理。JS 生成時はエラー（`unsupported-in-p0`）、インタープリタでは EffectCall が実行時エラー（§7.5）。
- `prop` は構文+型検査のみ。評価（反例生成・縮小）は P1。REPL の `prop` は `unsupported-in-p0` を返す。
- `effect` 呼び出しの実行（ホスト DI）は P1。P0 では宣言の検査のみ。
- 非末尾再帰のスタック制限は実装依存（§8.5）。実測値（Node.js v22.23.4、デフォルトスタック、この環境）:
  - 生成 JS バックエンド: `fact` 換算で約 **7512** 段まで（`RangeError: Maximum call stack size exceeded`）
  - インタープリタ: 約 **794** 段まで
  - 末尾呼び出しは最適化しない（SHOULD、§8.5）。スタックオーバー時は JS の RangeError を指す実行時例外（§8.6）。

## 既知の差異（SPEC.md とのズレ・未実装）

- **GUIDE.md §4 のディレクトリ構成**: このリポジトリの GUIDE.md には §4 が存在しない（別プロジェクト Contrast 用の内容）。`src/` の構成は SPEC.md §2–§12 のパイプラインから導出した。
- **演算子トークン**: §2.2 の BNF では `+ - * / < > <= >= =` は punct。よって `(+ 1 2)` の `+` は punct トークンであり、パーサが punct 先頭を関数適用として扱う（§0.1 の字句追加と整合）。
- **export 検査の緩和**: §3.8 を厳密に読むと型名も export 対象だが、付録A は `Money` を export せずに cart.lts が import している。実装では値名前空間（defn/effect）のみ `not-exported` を強制し、型名前空間は定義されていれば import 可（§6.6 の分離を優先）。
- **stdlib の可変長**: §11.1 の算術演算子は P0 では2引数固定（可変長は P1）。§11.2 の `str-concat` と `array` は `...` 表記どおり可変長。
- **Do の末尾位置限定（§7.3）**: 脱糖後の Core で Do が末尾位置のみに現れることの静的検査は未実装（実行時はどの位置でも早期リターン相当で評価される）。
- **match の lowering**: §12.4 は「switch または if 連鎖」を許容するが、実装は if 連鎖のみ（tag 分解の switch は未実装）。
- **source map ＞ names**: Rust バックエンド（sourcemap crate）は元名（例: `add-money`）を names に出力するため、`node --enable-source-maps` でのスタックトレースは `add-money (file.lts:行:列)` の形式で表示される（T8）。
- **example の JS 出力**: 生成 JS では example をトップレベルのブロックで評価し、失敗時に throw・成功時に `console.log` する（§10.5 は compile の出力形式のみ規定）。
- **compile の診断順序**: lexer → parser → desugar → check → emit の順に連結して出力する。
- **REPL の `test` の結果名**: example に名前がないため `example <index>` 形式で返す。
- **`/ 0` 系**: `(/ 1 0)` = Infinity、`(/ 0 0)` = NaN であり例外にしない（§8.6）。`=` は構造的等価で NaN ≠ NaN（§8.3）。

## ディレクトリ構成

```
src/
  main.rs         CLI エントリ（clap）
  lib.rs          pub mod 宣言
  span.rs         Span
  diagnostic.rs   Diagnostic / Patch / AST パス（§9）
  token.rs        トークン種
  lexer.rs        §2
  ast.rs          サーフェス AST（トリビア含む）
  parser.rs       §3
  ir.rs           Core IR（§5）
  desugar.rs      §4/§5
  types.rs        Type / Scheme（§6.1–6.2）
  unify.rs        §6.4
  check.rs        §6.3 / §11
  stdlib.rs       §11
  exhaustive.rs   §6.5
  effects.rs      §7
  resolver.rs     §3.8
  value.rs        Value（§8.2–8.3）
  eval.rs         §8
  emit.rs         §12.4
  runtime.rs      backend/runtime.js を include_str! で埋め込む
  sourcemap_out.rs  source map v3 生成
  fmt.rs          §10.3
  repl.rs         §10.1
  backend/runtime.js  生成JSが import するランタイム（唯一の非Rustソース）
tests/          cargo の統合テスト（fixtures/ + golden/ + acceptance/ T1–T9）
```
