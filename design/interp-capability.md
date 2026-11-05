# λ LisTS インタープリタ実装言語化 SPEC（interp-capability）v0.1

> リポジトリの `SPEC.md`（v0.2/v0.3）に追記・改訂するための**差分仕様書**。
> 既存SPECの条文番号体系を前提とする。採用判断後に本編SPECへ統合する。

## 0. 位置づけと思想整合

本仕様は λ LisTS を「自作インタープリタの実装言語」として第一級にするための追加能力を定める。全項目は七原則（決定性・脱出ハッチなし・純粋性分離・機械可読診断・kebab-case・S式単一構文・エフェクト明示）を破らない。マクロ・リーダマクロ・call/cc・正規表現・遅延評価は**採用しない**（§8 参照）。

## 1. 型システム追加

### 1.1 map / set（C1）

- `(map K V)`: 動的キーの永続マップ。キーは `str` / `sym` / `int` に限定。
- `(set K)`: キーのみの集合。
- 構造的等価: キー集合と値が等しければ等価。値は木構造のため循環なし。`=` は map に適用可能。
- `obj` との関係: `obj` は固定キー構造体型として存続。`obj->map` の単方向変換のみ提供。
- 出力反復は挿入順でなければならない（決定性）。

```lisp
(map-empty : (-> (map K V)))
(map-get   : (-> (map K V) K (result V not-found)))
(map-set   : (-> (map K V) K V (map K V)))
(map-del   : (-> (map K V) K (map K V)))
(map-keys  : (-> (map K V) (array K)))
(map-has?  : (-> (map K V) K bool))
(map-size  : (-> (map K V) int))
(set-empty : (-> (set K)))
(set-add   : (-> (set K) K (set K)))
(set-has?  : (-> (set K) K bool))
(set->array: (-> (set K) (array K)))
```

### 1.2 char（C2の一部）

- 新プリミティブ型 `char`（Unicodeスカラー値1つ）。リテラルは `\<文字>`（strリテラルのエスケープ規則に準拠）。
- `char-code` は int（スカラー値）を返す。サロゲートは存在しない。

### 1.3 i64（C4）— 設計ゲート項目

- リテラル: `123i`。範囲は Rust `i64` と同一。JSバックエンドは BigInt で生成。
- 演算: i64同士の `+ - * quotient remainder min max < > <= >= =` のみ。**f64 との混合演算は type-mismatch**。
- 変換: `i64->num`（常に成功）、`num->i64 : (-> num (result i64 not-integer))`（小数部非ゼロは err）。
- オーバーフロー・0除算は実行時エラー。診断 kind に `integer-overflow` を追加。
- §14 P5 の i64/i53 注記の**実験的前倒し**であることを変更ログに記載。

### 1.4 bytes（C8）

- `(bytes)`: 不変バイト列。`bytes-get` / `bytes-len` / `bytes-slice`。
- `str->bytes`（UTF-8エンコード、常に成功）、`bytes->str : (-> bytes (result str invalid-utf8))`。
- `str->codepoints : (-> str (array int))` / `codepoints->str : (-> (array int) (result str invalid-code))`。

### 1.5 ref（C6）— エフェクト型

- 型 `(ref v)`。全操作は組み込みエフェクト（`defn!` からのみ呼び出し可能）:

```lisp
(ref!    : (-> v (ref v)))
(ref-get!: (-> (ref v) v))
(ref-set!: (-> (ref v) v unit))
```

- host能力ではなく言語内完結の組み込みエフェクト。`(effect ref)` 相当として宣言・検査される。
- 循環構造の `=` 適用は、interp値が木構造である根拠と同様に存在しない。

## 2. 構文追加

### 2.1 letrec（C5）

- 構文: `(letrec [name lam-expr] body...)`。name は lam-expr 内で参照可能。
- **制約**: 束縛対象は Lam に限定。データの循環は作れない。違反は type-mismatch。
- 脱糖: Core IR に `Letrec` ノードを追加。決定的に展開され、JS生成は自己参照関数式で素直に写像。
- 相互再帰defn（モジュールレベル）は本仕様の対象外（モジュール本設計はP1留保）。

## 3. stdlib 追加

### 3.1 文字列・文字（C2）— 単位は Unicode スカラー値

```lisp
(char-at        : (-> str int (result char out-of-range)))
(char-code      : (-> char int))
(code->char     : (-> int (result char invalid-code)))
(str-take-while : (-> str int (-> char bool) (obj (acc str) (pos int))))
(str-skip-while : (-> str int (-> char bool) int))
(str-split-at   : (-> str int (result (obj (left str) (right str)) out-of-range)))
(str-contains?  : (-> str str bool))
(char<=? char=? char-alphabetic? char-numeric? char-whitespace? : char述語)
```

- 位置ベースAPIを主軸とし、レキサーが部分文字列を無駄に作らない設計とする。

### 3.2 builder（C3）— 純粋値

```lisp
(builder-empty : (-> builder))
(builder-push  : (-> builder str builder))
(builder->str  : (-> builder str))
(builder-join  : (-> (array str) str str))
```

- builder は不変値。償却 O(n) を実装が保証する（SPECは計算量を条文化しない）。

## 4. エフェクト追加（C9）

```lisp
(effect now!     : (-> unit num))
(effect elapsed! : (-> unit num))
(effect trace!   : (-> str unit))
```

- host 能力インターフェース（M20）に追加。interp はモックhostで決定的、JSバックエンドは `Date.now` / `console.error` に写像。
- `trace!` は M20 の host-log を一般化したもので、host-log は糖衣として残す。

### 4.1 host 読み取り（C8連動）

```lisp
(effect read-file! : (-> str (result bytes io-error)))
```

## 5. condition system（C7）— 方向性のみ

- `do` の bind 対象を `result` から `condition`（resultの一般化）へ拡張する方向。
- ハンドラ: `(with-handler (kind pred) recover-body body...)`（宣言の詳細は採用後に別途条文化）。
- MUST: 診断JSONとの1対1対応。ハンドラで回復した診断は `info` に降格。
- 本版では採用可否のみ判断対象とし、実装は次版とする。

## 6. 診断 kind 追加

`not-found` `out-of-range` `invalid-code` `invalid-utf8` `not-integer` `integer-overflow` `io-error`（いずれも実行時エラー/Resultエラー型。`integer-overflow` は kind として新規）。

## 7. JS 生成への写像

| 機能 | 写像 |
|------|------|
| map / set | 内部 `Map`。挿入順反復。構造的等価は再帰 deep-equal（循環なし） |
| char | 1要素文字列（コードポイント単位、サロゲートなし） |
| i64 | `BigInt`（リテラルは `123n`）。混合演算は検査段階で排除済み |
| bytes | `Uint8Array`（不変扱い。変更操作はstdlibに存在しない） |
| builder | 配列蓄積 + `join` |
| ref | 通常オブジェクト `{value}` |
| letrec | 名前付き関数式 / 自己参照 `const` + 関数 |
| now! / trace! | `Date.now()` / `console.error` |

## 8. 決定事項（見送り）

| 項目 | 理由 |
|------|------|
| マクロ / リーダマクロ | 単一構文・決定的脱糖と正面衝突。ASTヘルパ関数で代替 |
| call/cc | 過剰。エフェクト設計を複雑化 |
| 正規表現 | 意味論の曖昧さ。位置ベースAPIで代替 |
| 遅延評価 / thunk | letrec + ref! で必要十分 |

## 9. 受入条件

1. 既存 cargo test 全数緑 + スモーク拡張（S12 map決定性、S13 レキサーAPI、S14 letrec/ref差分一致、S15 i64オーバーフロー診断、S16 prop差分一致、S17 bytes往復）。
2. interp と JSバックエンドの差分一致が全追加機能で成立。
3. ゴールデン例 `interp-demo.lts`: λ LisTS で書かれたミニS式インタープリタ（パーサ + evaluator + REPLループ）が差分一致で動作すること。

## 10. 未決定（判断待ち）

1. i64（C4）採用可否 — P5前倒しの許容。
2. letrec（C5）と ref!（C6）の双方か C5のみか。
3. condition system（C7）の前倒し可否。
4. map 実装の自前HAMT vs 単純永続木、計算量の条文化有無。
5. char リテラル構文 `\<文字>` の採用。
6. `num->i64` 失敗時の kind 命名（`not-integer` は仮称）。
