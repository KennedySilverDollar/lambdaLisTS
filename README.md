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

詳細な説明・既知の差異は [docs/README.md](docs/README.md) を参照してください。
