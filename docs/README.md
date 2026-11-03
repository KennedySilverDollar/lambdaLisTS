# λ LisTS — P0 プロトタイプ

SPEC.md v0.2 (P0) に基づく λ LisTS の P0 実装。レキサ → パーサ → 脱糖 (Core IR) → 双方向型検査 → 網羅性検査 → エフェクト/モジュール検査 → インタープリタ → JS バックエンド → CLI/REPL/フォーマッタまでを含む。

## ビルド

```sh
npm install
npm run build        # tsc → dist/（source map 付き）
```

## テスト

```sh
npm test             # vitest run（全テスト:単体 + 受け入れ T1–T9）
```

## 実行

```sh
# コンパイル（診断は Diagnostic[] の JSON で stdout、exit 0/1。--out に .js/.js.map と runtime.js を出力）
npm run cli -- compile test/fixtures/money.lts test/fixtures/cart.lts --out /tmp/out
node /tmp/out/cart.js          # example を実行して結果を表示

# フォーマット（in-place）
npm run cli -- fmt test/fixtures/money.lts

# REPL（JSON Lines: 1行1JSON in → 1行1JSON out）
npm run cli -- repl
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
- **source map の names**: magic-string は names を出力しないため、バックエンド側で関数宣言ごとに元名（例: `add-money`）を names に注入している。これにより `--enable-source-maps` のスタックトレースは `at add-money (file.lts:行:列)` と表示される（T8）。
- **example の JS 出力**: 生成 JS では example をトップレベルのブロックで評価し、失敗時に throw・成功時に `console.log` する（§10.5 は compile の出力形式のみ規定）。
- **compile の診断順序**: lexer → parser → desugar → check → emit の順に連結して出力する。
- **REPL の `test` の結果名**: example に名前がないため `example <index>` 形式で返す。
- **`/ 0` 系**: `(/ 1 0)` = Infinity、`(/ 0 0)` = NaN であり例外にしない（§8.6）。`=` は構造的等価で NaN ≠ NaN（§8.3）。

## ディレクトリ構成

```
src/
  lexer/      token.ts, lexer.ts          §2
  parser/     ast.ts, parser.ts           §3
  core/       ir.ts, desugar.ts           §4/§5
  types/      type.ts, unify.ts, stdlib.ts, check.ts, exhaustive.ts   §6/§11
  effects/    check.ts                    §7
  modules/    resolver.ts                 §3.8
  interp/     value.ts, env.ts, stdlib.ts, eval.ts   §8
  backend/    runtime.ts, sourcemap.ts, js.ts        §12
  tools/      cli.ts, repl.ts, fmt.ts     §10
  diagnostic.ts                           §9
test/         単体テスト + fixtures/ + acceptance/（T1–T9）
```
