# λ LisTS Language Specification v0.2 (P0) — Rust Edition

言語の正式名称は **λ LisTS** とする（本文中では単に LisTS とも記す）。

Status: Draft for P0 implementation（v0.1 再考証修正版・Rust記法版）
Backend: JavaScript（ES2022, ESM）
Compiler implementation: Rust（edition 2021）
Scope: Pure core + Result + minimal effects checking

---

## 0. この仕様の位置づけ

本仕様は P0（最初の実装可能な最小版）を定義する。P1以降の機能は §14 に記す。本仕様に反する実装は非準拠とする。

規範的な用語：

- MUST / しなければならない：必須
- SHOULD / すべき：推奨（正当な理由があれば逸脱可）
- MAY / してよい：任意

### 0.1 v0.1 → v0.2 の変更点（破壊的）

| # | 変更 | 理由 |
|---|---|---|
| 1 | 演算子トークン（`+ - * / < > <= >= = -> => :`）を字句に追加 | v0.1では `(+ 1 2)` がレキス不能だった |
| 2 | `!` をシンボル名の文字クラスから除去し、suffix 専用に | v0.1の `symbol ::= symbol-name '!'?` が機能しなかった |
| 3 | 引数構文をフラット＋コロン形式に確定：`(defn f (x : T) (y : U) : R)` | 文法と例文の不一致解消。1引数=1フォーム=1差分行 |
| 4 | do の bind を `[name expr]` 括弧ペアに確定。名前なし bind は P1 へ | 3種混在の解消。match アームと同形 |
| 5 | 型リテラル（文字列）を追加：`(tag "EmptyCart")` フィールド | 判別union・網羅性検査の前提が欠けていた |
| 6 | 型変数の unify 規則を追加（rank-1、stdlib専用、呼び出し時実体化） | `ok` `map` `fold-left` `=` が型付け不能だった |
| 7 | when / cond / and / or を expr 文法に追加（脱糖表と一致） | v0.1で文法化されていなかった |
| 8 | フィールドアクセスを `o.a` ドット記法に一本化。`field` 関数は削除 | 「1つのことを1つの方法で」 |
| 9 | prop の評価（生成・縮小）を P1 に繰延。P0 は構文＋型検査のみ | 段階的開示（原則6）。T4 相当は P1 受入へ |
| 10 | 文字列操作を `str-concat` / `str-slice` に改名 | `concat`/`slice` の配列版とのオーバーロードが非目標と矛盾 |
| 11 | コメントを AST トリビアとして保持。フォーマッタはコメント保存 | 「ASTが真実」と一意フォーマッタの両立 |
| 12 | union 正規化のソート順と型の正規表示を定義 | 決定性（原則5）に必須だった |
| 13 | 診断 kind 追加（duplicate-definition 等）、fix を特定 kind で MUST | 思想原則4「エラーは最高のプロンプト」 |
| 14 | CLI・ビルドレイアウト・runtime import パスを規定 | 生成JSが実行不能だった |
| 15 | 受入テストの相互参照を修正、テスト用ソースを付録Bに集約 | T1–T3 の参照先が存在しなかった |

### 0.2 本版（Rust版）について

- 本書は v0.2 の**言語規定をそのまま**に、規範的な型定義（Core IR・Type・Diagnostic・Value・Span）を TypeScript 記法から **Rust 記法**に置き換えた版である。文法・型規則・意味論・stdlib・JSバックエンド・受入テストに変更はない。
- 規範の優先順位：**言語規定（文章） ＞ 本書の Rust 型定義 ＞ テキスト版の TS 定義**。食い違いがあれば言語規定が勝つ。
- Rust 記法上の調整（`else_` / `ResultT` / `FnT` / `Str` 等の命名、パターンへの span 追加）は §付録C に列挙する。意味論的な変更ではない。
- コンパイラ実装の規約（依存・unsafe 禁止等）は本書ではなく `GUIDE.md`（Rust版）が持つ。

---

## 1. 設計原則

1. 構文はS式のみ。マクロなし。リーダマクロなし。
2. 純粋性は構文で分離。defn（純粋）と defn!（エフェクト）。
3. 型は双方向。関数シグネチャの注釈必須。ローカル変数のみ推論。
4. 脱出ハッチなし。any・キャスト・eval は存在しない。
5. 1つのことを1つの方法で。命名・引数順・糖衣は決定的。
6. エラーは機械可読。構造化JSON＋パッチテンプレート。
7. ASTが真実。テキストは描画。全ノードに安定span。コメントはトリビアとして保持。
8. 段階的開示。P0で覚えることを最小に。

---

## 2. 字句構造

### 2.1 文字コード

ソースは UTF-8。BOMは許容するが無視する。改行は LF を MUST とする（CRLF は読み込み時に LF に正規化）。

### 2.2 トークン

```bnf
token      ::= ws | comment | paren | bracket | brace | punct | atom
ws         ::= (' ' | '\t' | '\n' | '\r')+
comment    ::= ';' ~'\n'* '\n'?                ; 行コメント
paren      ::= '(' | ')'
bracket    ::= '[' | ']'
brace      ::= '{' | '}'                       ; 予約（P0では未使用）
punct      ::= '<=' | '>=' | '=>' | '->'
            | ':' | '+' | '-' | '*' | '/' | '<' | '>' | '='
atom       ::= number | string | keyword | symbol | dotted-symbol | nil | bool
```

字象の規則：

- **最長一致**。`<=` `>=` `=>` `->` は2文字トークンとして優先する。
- `-` は直後に数字が続く場合のみ number の一部（`-5`）。それ以外は punct。
- `+` は number の一部にならない（`+5` は不正。`(+ 5)` と書く）。

### 2.3 アトム

```bnf
number     ::= /-?[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?/
string     ::= '"' (escape | ~["\\\n])* '"'
escape     ::= '\\' ('"' | '\\' | 'n' | 't' | 'r' | 'u' hex{4})
keyword    ::= ':' symbol-name                 ; :else 等、cond 専用
symbol     ::= symbol-name '!'?
symbol-name::= /[a-zA-Z_][a-zA-Z0-9_\-?]*/     ; '!' を含まない
dotted-symbol ::= symbol ('.' symbol-name)+   ; o.a / i.price.amount
nil        ::= 'nil'
bool       ::= 'true' | 'false'
```

規約：

- シンボル名は kebab-case を MUST とする（camelCase・snake_case は name-convention エラー）。`_` 単体はワイルドカード専用。
- 末尾 `!` はエフェクト呼び出し（§7）。エフェクト名そのものは `!` なしで宣言する。
- `dotted-symbol` は Field アクセス（§3.5）に脱糖される。ドットの中間に `!` を含むシンボルは不可（`o.f!` は不正）。
- 予約語：`defn defn! fn let if when cond and or match do obj type effect prop forall example import export nil true false`。型位置コンストラクタ `Array union Result Option` も予約。

### 2.4 コメントの保持

コメントは式ではなく、**トリビア**として次のフォームのノードに `leading` として付随する（MUST）。ファイル末尾のコメントは program ノードに付随する。コメントは型検査の対象外だが、フォーマッタは正規位置に保存する（§10.3）。

### 2.5 span

すべてのASTノードは span を持た MUST。

```rust
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]   // serde の "rc" feature 有効化
pub struct Span {
    pub file: Rc<str>,
    pub start: usize,   // バイト位置
    pub end: usize,     // バイト位置
    pub line: usize,    // 1始まり
    pub col: usize,     // 1始まり・Unicodeスカラー値換算（UTF-8 バイト数ではない）
}
```

- start/end は**UTF-8バイト位置**、line/col は1始まりで、col は**Unicodeスカラー値換算**とする（MUST）。走査は `char_indices` を用いる。
- コメント・空白は span に含めない。

---

## 3. 構文

### 3.1 プログラム

```bnf
program   ::= top-form*
top-form  ::= import | export | type-def | effect-def | defn | defn! | prop | example
```

### 3.2 リストとベクタ

`( ... )` と `[ ... ]` はリーダレベルで同一のリストノード。**正規用法は文脈で固定**（決定性）：`[...]` は let の bind ベクタ・match のアーム・do の bind・forall の量化子に限定し、それ以外の `[...]` はパーサが `(...)` に正規化する。`{ ... }` は予約（P0ではパースエラー）。

### 3.3 型構文

```bnf
type   ::= 'number' | 'string' | 'bool' | 'nil'
         | symbol                                    ; 型エイリアス
         | '(' 'Array' type ')'
         | '(' 'union' type+ ')'
         | '(' 'obj' field* ')'
         | '(' 'Result' type type ')'
         | '(' 'Option' type ')'                     ; (union T nil) の糖衣
         | '(' 'fn' param* ':' type ')'

field  ::= '(' symbol ':' type ')'                   ; 通常フィールド
         | '(' symbol string ')'                     ; リテラルフィールド（tag）
param  ::= '(' symbol ':' type ')'
```

- リテラルフィールド `(tag "EmptyCart")` は、そのフィールド型を文字列リテラル型（§6.1）とする。判別union（tagによる分解・網羅性検査）の前提。
- `(Option T)` は脱糖で `(union T nil)` に正規化する。**`nil` が「値なし」を表す。`None` のようなタグ値は存在しない。**

### 3.4 定義

```bnf
type-def   ::= '(' 'type' symbol type ')'
effect-def ::= '(' 'effect' symbol ':' type ')'       ; P1で使用、P0は宣言のみ受理
defn       ::= '(' 'defn'  symbol param* ':' type body ')'
defn!      ::= '(' 'defn!' symbol param* ':' type body ')'
```

規則：

- defn は純粋関数（MUST）。エフェクト呼び出しを含んではならない。
- defn! はエフェクト関数（P0では宣言・型付け・検査のみ受理、P1で完全実装）。
- 引数0の関数は `()` で表す：`(defn zero () : Money ...)`。

### 3.5 式

```bnf
body  ::= expr
expr  ::= atom | symbol | dotted-symbol
       | '(' symbol expr* ')'                        ; 関数適用 or 特殊フォーム
       | '(' 'let' '[' bind* ']' expr ')'
       | '(' 'if' expr expr expr ')'
       | '(' 'when' expr expr ')'
       | '(' 'cond' cond-arm+ '[' ':else' expr ']' ')'
       | '(' 'and' expr expr ')'
       | '(' 'or' expr expr ')'
       | '(' 'match' expr arm+ ')'
       | '(' 'do' do-bind* expr ')'
       | '(' 'obj' '(' symbol expr ')'* ')'
       | '(' 'fn' param* ':' type expr ')'
       | '(' '->' expr expr+ ')'                     ; パイプ糖衣

bind     ::= symbol expr
do-bind  ::= '[' symbol expr ']'                     ; symbol は '_'（破棄）可
cond-arm ::= '[' expr expr ']'
arm      ::= '[' pattern expr ']'
```

- `cond` の最終 `[:else e]` は MUST（網羅性を文法で強制）。
- do の bind は `[name expr]` 形式のみ（MUST）。名前なし評価破棄 `(do e1 e2)` は P0 に存在せず、P1 の do-io で導入する。
- `_` に束縛された値は参照できない（コンパイルエラー）。

### 3.6 パターン

```bnf
pattern ::= '_'                                       ; ワイルドカード
          | symbol                                    ; 変数束縛
          | number | string | bool | nil              ; リテラル
          | '(' 'obj' '(' symbol pattern ')'* ')'      ; オブジェクトパターン
          | '(' 'Array' pattern* ')'                  ; 配列パターン
          | '(' 'or' pattern+ ')'                      ; 選択
```

### 3.7 テスト

```bnf
prop    ::= '(' 'prop' string '(' 'forall' '[' param* ']' expr ')' ')'
example ::= '(' 'example' expr '=>' expr ')'
```

- `example` は P0 で実行される：期待値と構造的等価（§8.3）で比較する。
- `prop` は P0 では**構文受理＋型検査のみ**。反例生成・縮小の評価は P1（§14）。

### 3.8 モジュール

```bnf
import ::= '(' 'import' string '(' symbol* ')' ')'
export ::= '(' 'export' symbol* ')'
```

規則：

- import のパスは相対パス（`./`、`../`）またはパッケージ名（P1）。
- `*` ワイルドカード・`as` リネームは禁止（MUST）。
- export されていないシンボルは他ファイルから参照不可。export/import は型名前空間と値名前空間の両方を対象とする（§6.6）。

---

## 4. 脱糖（Surface → Core IR）

すべての糖衣は決定的に Core IR（§5）へ展開される。

| Surface | Core IR |
|---|---|
| `(let [a e1 b e2] body)` | `Let(a, e1, Let(b, e2, body))` |
| `(do [x e1] [y e2] body)` | `Do([{x,e1},{y,e2}], body)` |
| `(when c e)` | `If(c, e, Lit(nil))` |
| `(cond [c1 e1] ... [:else eN])` | `If(c1, e1, If(..., eN))` |
| `(and a b)` | `If(a, b, Lit(false))` |
| `(or a b)` | `Let($t, a, If($t, Lit(true), b))` |
| `(-> x f)` | `App(f, [x])` |
| `(-> x f g)` | `App(g, [App(f, [x])])` |
| `(obj (a e1) (b e2))` | `Obj([["a",e1],["b",e2]])` |
| `(Option T)`（型） | `(union T nil)` |
| `a.b.c`（dotted-symbol） | `Field(Field(Var a, "b"), "c")` |

let は単一束縛に正規化（MUST）。do の bind は順序を保つ。`and`/`or` の脱糖は条件式が bool であること（§6.3）を前提とする。

---

## 5. Core IR

```rust
#[derive(Debug, Clone, PartialEq)]
pub enum Core {
    Lit { value: Value, span: Span },
    Var { name: Rc<str>, span: Span },
    Lam { params: Vec<Param>, ret: Type, body: Box<Core>, pure: bool, span: Span },
    App { f: Box<Core>, args: Vec<Core>, span: Span },
    Let { name: Rc<str>, rhs: Box<Core>, body: Box<Core>, span: Span },
    // else はRustの予約語のため else_ とする
    If { cond: Box<Core>, then: Box<Core>, else_: Box<Core>, span: Span },
    Match { scrutinee: Box<Core>, arms: Vec<MatchArm>, span: Span },
    Obj { fields: Vec<(Rc<str>, Core)>, span: Span },      // 構築順を保持
    Field { obj: Box<Core>, name: Rc<str>, span: Span },
    EffectCall { effect: Rc<str>, args: Vec<Core>, span: Span },
    Do { binds: Vec<DoBind>, body: Box<Core>, span: Span },
    Error { message: String, span: Span },                 // パース回復用
}

#[derive(Debug, Clone, PartialEq)]
pub struct Param { pub name: Rc<str>, pub ty: Type }

#[derive(Debug, Clone, PartialEq)]
pub struct DoBind { pub name: Rc<str>, pub expr: Core }     // "_" は束縛なし・参照不可

#[derive(Debug, Clone, PartialEq)]
pub struct MatchArm { pub pattern: Pat, pub body: Core }

#[derive(Debug, Clone, PartialEq)]
pub struct Pat {
    pub kind: PatKind,
    pub span: Span,        // Rust版の追加：回復診断・fix の path 安定化に必要
}

#[derive(Debug, Clone, PartialEq)]
pub enum PatKind {
    Wildcard,                       // '_'
    Var(Rc<str>),
    Lit(Value),                     // number | string | bool | nil
    Obj(Vec<(Rc<str>, Pat)>),
    Array(Vec<Pat>),
    Or(Vec<Pat>),
}
```

不変条件：

- `Lam { pure: true }` のとき body に EffectCall を含まない（エフェクト検査が保証）。
- Do は末尾位置限定（§7.3）。式中に現れない。DoBind の `_` は `"_"` として保持し、Var で参照不可。
- Match.arms は網羅的（型検査が保証）。

---

## 6. 型システム

### 6.1 型の表現

```rust
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub enum Type {
    Number,
    Str,                            // 表示は "string"
    Bool,
    Nil,
    Literal(Rc<str>),               // 文字列リテラル型（P0: tag専用）
    Array(Box<Type>),
    Union(Vec<Type>),               // 正規化済み（重複除去 + §6.2 ソート）
    Obj(BTreeMap<Rc<str>, Type>),   // 構造的、幅部分型。順序安定
    ResultT(Box<Type>, Box<Type>),  // 表示は "(Result T E)"
    FnT(Vec<Type>, Box<Type>),      // 表示は "(fn (T ...) : R)"
    Var(usize),                     // 型変数（stdlib用、rank-1）
    Alias(Rc<str>),                 // 展開済み
}

#[derive(Debug, Clone)]
pub struct Scheme {
    pub vars: Vec<usize>,
    pub body: Type,
}
```

- `ResultT` / `FnT` は std の `Result`・`Fn` との衝突回避命名。意味論は §3.3 の `Result` / `fn` と同一。
- **Rust の `str` 比較（`Ord`）は UTF-8 バイト順**であり、§6.2 の「正規表示バイト列辞書順」と自然に一致する。union のソートと正規表示は同じ比較で構成する（MUST）。

### 6.2 正規化と正規表示

- **union 正規化**：重複除去（構造的等価）→ **ソートは「正規表示文字列」のバイト列辞書順**（決定的、MUST）。
- **正規表示（type-of ・エラー表示・デバッグで使用）**：
  - プリミティブ：`number` `string` `bool` `nil`
  - リテラル：`"EmptyCart"`（文字列リテラル型は引用符付きで表示）
  - `(Array T)` `(Result T E)` `(Option T)`（nil含有unionは Option 表示）
  - `(union T1 T2 ...)`（正規化順）
  - `(obj (a : T) (b : U))`（フィールド名でソート）
  - `(fn (T1 T2) : R)`（パラメータ型のリスト、名前は含めない）
  - エイリアスは展開済みの正規表示を用いる
- obj は幅部分型：`{a, b}` は `{a}` に代入可能。構造的等価（MUST）。

### 6.3 双方向型付け

2つのモード：`infer(expr) -> Type`（推論）、`check(expr, expected)`（検査）。Rust では `Result<Type, Vec<Diagnostic>>` / `Result<(), Vec<Diagnostic>>` とし、パニックしない。

| 式 | 規則 |
|---|---|
| リテラル | infer = リテラル型（number/string/bool/nil） |
| 変数 | infer = 環境の型 |
| `a.b` | infer(a) が obj 型で、フィールド b が存在すること。結果はそのフィールド型。a が union の場合は全メンバーに b が存在すれば可 |
| Lam | シグネチャ注釈から fn 型を構築。本体を check(body, ret) |
| App | infer(fn) が fn 型であることを要求。引数を check(arg, param_i)。結果は ret |
| Let | infer(rhs) を環境に束縛。本体を check |
| If / when | check(cond, bool)。両分岐を check(e, expected)（expected が無いときは infer して unify） |
| and / or | 両引数を check(_, bool)。結果は bool |
| Match | infer(scrutinee)。各アームのパターンを束縛。本体を check。網羅性検査（§6.5） |
| Obj | フィールドの型を infer。obj 型を構築 |
| **Do** | do は check モード限定。期待型が `Result<T,E>` でなければ type-mismatch。各 bind：infer(expr_i) = `Result<Ti,Ei>`、`unify(Result<Ti,Ei>, Result<Ti,E>)`。name は Ti に束縛（`_` は束縛なし）。body を check(body, Result<T,E>)。do の型 = `Result<T,E>` |
| EffectCall | effect 宣言のシグネチャと照合（§7） |

### 6.4 単一化（unify）

```
unify(T, T) = ok（構造的に同一）
unify(lit s, lit s) = ok
unify(lit s, string) = ok          ; リテラルは string に適合
unify(T, union(m1..mn)) = いずれかのメンバーと unify すれば ok
unify(union A, union B) = A ⊆ B（A の全メンバーが B のいずれかと unify）
unify(obj1, obj2) = obj2 の全フィールドが obj1 に存在し、型が unify（幅部分型）
unify(result(T1,E1), result(T2,E2)) = unify(T1,T2) ∧ unify(E1,E2)
unify(fn(P1)->R1, fn(P2)->R2) = 引数・戻り値を unify
unify(var i, T) = bind + occurs check
```

**型変数の取り扱い（P0）**：

- stdlib 関数は Scheme（量化された型変数を持つシグネチャ）として登録される。
- 呼び出し毎に新しい型変数で実体化する（rank-1、呼び出し時実体化）。
- ユーザーが型変数をシグネチャに書くことは P0 ではできない（P3で本格化）。
- ローカル変数の推論は型変数を生成しない。

失敗時は構造化エラー（§9）を返す。expected と actual の正規表示を data に含める。

### 6.5 網羅性検査（Maranget のアルゴリズム）

match のパターン行列に対し、以下を検査する：

1. 網羅性：全ケースが覆われているか。覆われていなければ missing パターンを報告し、そのアームの fix テンプレートを添える。
2. 冗長性：到達不能なアームを警告。

判別union（tag リテラルフィールドを持つ obj）に対しては tag による分解を優先する。P0では素朴な再帰アルゴリズムでよい（性能はP2で最適化）。union のメンバーが obj 型で tag フィールドを持つ場合、tag 値の集合が全リテラルをカバーすれば網羅と判定する。

### 6.6 名前空間

- **型名前空間**（type 定義名・型コンストラクタ）と**値名前空間**（関数・変数・effect名）は分離する（MUST）。
- 同名の共存を許す（例：型 `Money` と関数 `money`）。型位置の symbol は型名前空間のみ、式位置の symbol は値名前空間のみを参照する。
- 同一名前空間内の二重定義は duplicate-definition エラー。

---

## 7. エフェクトシステム

### 7.1 エフェクト宣言

```lisp
(effect log : (fn (s : string) : nil))
(effect db  : (fn (op : string) (key : string) : (Option string)))
```

effect は名前付きシグネチャを値名前空間に登録する。`log!` の呼び出しは `log` のシグネチャと照合される。

### 7.2 エフェクト集合

各関数 f にエフェクト集合 eff(f) ⊆ EffectNames を割り当てる。

```
eff(defn  f) = ∅                                    （MUST、検査で強制）
eff(defn! f) = direct-effects(body(f)) ∪ ⋃_{g ∈ calls(f)} eff(g)
```

direct-effects は本体に現れる EffectCall のエフェクト名集合。calls(f) は本体が呼ぶ defn! の集合。

### 7.3 末尾限定制約

Do は以下の位置にのみ現れてよい：

- 関数本体の最上位（戻り値型が Result であること）
- let の本体
- if / when の then/else（両方）
- match の各アームの本体
- cond の各腕と :else

式中に Do は現れない（MUST）。これにより生成コードが早期リターンに落ちる。

### 7.4 検査

1. defn の本体に EffectCall が含まれてはならない（MUST）→ effect-violation。
2. defn! は defn を呼べる。逆は禁止。
3. EffectCall のエフェクト名は effect 宣言済みでなければならない → unknown-effect。
4. EffectCall の引数型は宣言と一致しなければならない。
5. do の bind の式は `Result<T,E>` 型でなければならない（エフェクト式は P1 で例外的に許可）。

### 7.5 P0の制限

- defn! の完全実装は P1。P0ではパース・型付け・検査のみ受理し、JS生成時にエラー。
- 高階エフェクト多相は実装しない。

---

## 8. 意味論

### 8.1 評価戦略

- 正格評価（MUST）。引数は左から順に評価。
- if・match・and・or・cond は短絡。
- 関数適用は値呼び（call-by-value）。

### 8.2 値

```rust
#[derive(Debug, Clone)]
pub enum Value {
    Num(f64),
    Str(Rc<str>),
    Bool(bool),
    Nil,                                   // JS null。undefined は存在しない（MUST）
    Array(Vec<Value>),
    Obj(BTreeMap<Rc<str>, Value>),        // tag付きオブジェクトを含む
    Ok(Box<Value>),                       // JS { tag: "Ok",  value } に対応
    Err(Box<Value>),                     // JS { tag: "Err", value } に対応
    Closure(Rc<Closure>),                 // 実行時のみ。JS lowering の対象外
}

pub struct Closure {
    pub params: Vec<Param>,
    pub body: Rc<Core>,
    pub env: Env,          // 値環境
}
```

- Rust 版では Ok / Err を専用バリアントとする。JS バックエンドとの対応（`{tag:"Ok"|"Err"}`）は lowering が保証する。両表現の構造的等価は保存される。
- `Value::Obj` のキー順は `BTreeMap`（ソート済み）。**構造的等価はキー順に依存しない**（§8.3）ため、インタープリタと JS の差分一致を妨げない。

### 8.3 等価性

`=` は構造的等価：

- プリミティブ：`===`（NaN は NaN と等しくない）
- 配列：長さと各要素の再帰的等価
- オブジェクト：キー集合と各値の再帰的等価
- Result：tag と value の等価

```rust
pub fn structural_equal(a: &Value, b: &Value) -> bool;
```

### 8.4 Result の伝播

do 内で Err が発生した場合、残りの bind と本体をスキップし、その Err を返す（早期リターン意味論）。do の外側の式は評価されない。

### 8.5 再帰

- Core IR 上の末尾位置は次のとおりとする（MUST）: `Lam.body`、`Let.body`、`If.then`/`If.else_`、`Match` 各アームの `body`、`Do.body`。`App.f`・`App.args`・`Let.rhs`・`If.cond`・`Match.scrutinee`・`Obj` フィールド値・`Field.obj`・`Do` 各 bind の `expr` は末尾ではない。
- **proper tail call（末尾位置にある `App`）は定数スタックで実行される（MUST）**。すなわち深さに依らず成功しなければならない。JS バックエンドでは自己再帰のループ変換と相互再帰のトランポリンで実現する。WASM バックエンドでは tail-call proposal の `return_call`/`return_call_indirect` に対応する。
- 非末尾再帰のスタック制限は実装依存。Rust 実装では上限を定数として設け、超えた場合 internal-error 診断を返す（パニックしない）。上限値をドキュメントに明記。

### 8.6 数値と実行時エラー

- number は IEEE754 倍精度浮動小数点（JS 準拠）。Rust の `f64` は IEEE754 binary64 であり、JS と**同一の演算結果**を与える。NaN・±Infinity は number の値。`(/ 1 0)` は Infinity、`(/ 0 0)` は NaN（例外ではない）。decimal は P1。
- P0（純粋関数のみ）における「実行時エラー」とは、JS エンジンが投げる実行時例外（RangeError: Maximum call stack size exceeded 等）を指す。T8 の source map 検証はこれを対象とする。Rust インタープリタ側は対応する内部診断（深さ上限超過）とする。

---

## 9. エラーモデル

### 9.1 エラーの種類

| kind（kebab-case） | フェーズ | 内容 |
|---|---|---|
| parse-error | 字句・構文 | 括弧不足・過剰、不正トークン、if の引数不足 |
| type-mismatch | 型検査 | 型の不一致 |
| unbound-symbol | 型検査 | 未定義シンボル |
| non-exhaustive | 型検査 | 網羅性不足 |
| redundant-arm | 型検査 | 到達不能アーム（警告） |
| effect-violation | エフェクト検査 | 純粋関数からのエフェクト呼び出し |
| unknown-effect | エフェクト検査 | 未宣言エフェクト |
| arity-mismatch | 型検査 | 引数の数 |
| name-convention | 検査 | camelCase 等の違反 |
| duplicate-definition | 検査 | 同一名前空間内の二重定義 |
| type-syntax-error | 型検査 | 型構文の不正 |
| import-not-found | モジュール | import ファイル不在 |
| not-exported | モジュール | 未 export シンボルの参照 |
| module-cycle | モジュール | 循環参照 |
| internal-error | 任意 | コンパイラのバグ |
| unsupported-in-p0 | 実行 | P0範囲外（prop評価等）を要求された |

### 9.2 エラーの構造

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DiagKind {
    ParseError, TypeMismatch, UnboundSymbol, NonExhaustive, RedundantArm,
    EffectViolation, UnknownEffect, ArityMismatch, NameConvention,
    DuplicateDefinition, TypeSyntaxError, ImportNotFound, NotExported,
    ModuleCycle, InternalError, UnsupportedInP0,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum Severity {
    #[serde(rename = "error")]
    Error,
    #[serde(rename = "warning")]
    Warning,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Diagnostic {
    pub kind: DiagKind,
    pub severity: Severity,
    pub span: Span,
    pub message: String,                          // 人間向け（日本語）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,         // 機械向け（expected/actual/missing 等）
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fix: Option<Patch>,                      // パッチテンプレート
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "op")]
pub enum Patch {
    #[serde(rename = "replace")] Replace { path: String, template: String },
    #[serde(rename = "insert")]  Insert  { path: String, template: String },
    #[serde(rename = "delete")]  Delete  { path: String },
}
```

JSON 直列化は serde_json とする（`Map` はデフォルトでキーソート → 診断JSONは決定的）。REPL・CLI の1行出力は `serde_json::to_string`（コンパクト単一行）を用いる。

### 9.3 fix テンプレートの規約（思想原則4：エラーは最高のプロンプト）

- **fix は MUST**：type-mismatch / arity-mismatch / non-exhaustive / redundant-arm / effect-violation / unknown-effect / name-convention には必ずテンプレートを添える。それ以外（unbound-symbol 等）は SHOULD（類似名の提案など）。
- path は ASTパス（§10.2）。template はそのまま貼れる LisTS ソース。
- 型不一致：期待型を含む修正テンプレート。
- 網羅性不足：不足アームのテンプレート。
- エフェクト違反：`defn` → `defn!` 変更テンプレート。
- name-convention：kebab-case 変換テンプレート。

### 9.4 エラー回復

パーサはベストエフォートでASTを構築する（MUST）：

- 括弧不足：次のトップレベルフォームの直前で強制クローズし、Error ノードを挟む。
- 不正トークン：Error ノードとして保持し、次の区切りまで読み飛ばす。
- 1フォームの失敗は他のフォームのパースを妨げない。

---

## 10. ツール

### 10.1 REPL プロトコル（JSON Lines）

入力（1行1JSON）：

```json
{"id": 1, "op": "eval", "src": "(defn add (a : number) (b : number) : number (+ a b))"}
{"id": 2, "op": "test"}
{"id": 3, "op": "prop", "name": "add-money commutative"}
{"id": 4, "op": "reload", "file": "./cart.lts"}
{"id": 5, "op": "type-of", "src": "add"}
{"id": 6, "op": "quit"}
```

出力：

```json
{"id": 1, "ok": true, "defined": "add", "type": "(fn (number number) : number)"}
{"id": 2, "ok": true, "results": [{"example": "place-order空カート", "pass": true}]}
{"id": 2, "ok": false, "failures": [{"example": "...", "actual": "…", "expected": "…"}]}
{"id": 5, "ok": true, "type": "(fn (number number) : number)"}
{"id": 3, "ok": false, "errors": [{"kind": "unsupported-in-p0", "message": "prop評価はP1で実装"}]}
```

op と意味：

- `eval`：src をパース・検査・評価し、定義名と型を返す。診断がある場合は `ok: false` + `errors`。
- `test`：ロード済みの全 `example` を評価し、期待値と構造的等価で比較、結果リストを返す。
- `prop`：P0 では受理するが評価せず unsupported-in-p0 エラーを返す（P1 で反例・縮小を実装）。
- `reload`：ファイルを再読込し、依存も再検査する。
- `type-of`：src の型を正規表示（§6.2）で返す。
- `quit`：終了。

### 10.2 ASTパス

ASTノードを一意に指す文字列パス：

```
(defn add-money.body.2.then)
```

- トップレベル：`(defn <name>)` `(type <name>)` `(effect <name>)` `(prop <index>)` `(example <index>)`。
- 子ノード：`body`、`arms.<i>`、`then`、`else`、`binds.<i>`、`args.<i>`、`params.<i>` など。
- 安定性：ソースの変更に対してできるだけ安定（行番号より安定）。

### 10.3 フォーマッタ

一意な出力を MUST とする。スタイルオプションは提供しない。

- インデント：2スペース。1行の最大長：なし。
- 改行：`defn` `defn!` `match` `do` `cond` `example` は各要素を改行。その他は1行。
- 括弧の正規化：`[...]` は §3.2 の正規用法（let bind・match アーム・do bind・forall）のみに出力し、他は `(...)`。
- **コメントの保存**：ノードの leading コメントは整形後も同じノードの直前に置く。行末コメントは同一行に保持できる場合のみ保持する。
- 数値の正規化：往復して同じ値になる最短形式（`1.50` → `1.5`、`1E5` → `100000`）。
- 文字列の正規化：エスケープは `\n` `\t` `\r` `\"` `\\` `\uXXXX` に限定。

### 10.4 ソースマップ

JSバックエンドはソースマップ v3 を出力し MUST、以下を保証する：

- 実行時エラーのスタックトレースが .lts の行・列を指す。
- `(defn ...)` の関数呼び出しスタックが元の関数名 `add-money` を表示する。

生成は `sourcemap` クレートで行う（実装詳細。规範は出力形式のみ）。

### 10.5 CLI とビルドレイアウト

```
lists compile <file.lts>... [--out <dir>]   # 検査＋JS生成
lists fmt <file.lts>...                    # 一意フォーマット（in-place）
lists repl                                 # JSON Lines REPL
```

- `lists` は cargo でビルドされる**単一バイナリ**とする（外部ランタイム不要）。Node は生成JSの実行・テストにのみ使う。
- `compile` の診断は JSON 配列（Diagnostic[]）を **stdout** に出力する。エラーなしは `[]`。exit code は正常 0 / 診断あり 1。
- 出力：`<file>.js` + `<file>.js.map` をソースと同じ相対位置に（`--out` 指定時はルートを変更）。加えて出力ルート直下に `runtime.js` を一度だけ出力する。
- 生成JSは runtime を `import { ok, err, structuralEqual } from "<相対パス>/runtime.js"` で読む（モジュールの深さに応じた決定的な相対パス）。
- stdlib 関数は必要なものだけ `$stdlib_<name>` として import する。ユーザー定義による stdlib 名のシャドウは許容し、生成側で import 名を `$stdlib_<name>` に逃がす。

---

## 11. 標準ライブラリ（P0）

命名規則：**型ごとに別実装になる操作は別名にする**（`str-` 接頭辞等）。型変数による真の多相（`=` `map` `ok` 等）のみ単一定義とする。オーバーロード（同名・引数型で分散）は禁止（§15 準拠）。

### 11.1 数値

| 名前 | 型 |
|---|---|
| `+` `-` `*` `/` | `(fn (number number) : number)`（2引数固定。可変長はP1で検討） |
| `<` `>` `<=` `>=` | `(fn (number number) : bool)` |
| `=` | `(fn (T T) : bool)` 構造的等価 |
| `mod` `min` `max` | `(fn (number number) : number)`、`abs` は `(fn (number) : number)` |
| `not` | `(fn (bool) : bool)` |

### 11.2 文字列

| 名前 | 型 |
|---|---|
| `str` | `(fn (T) : string)` |
| `str-concat` | `(fn (string ...) : string)` |
| `str-slice` | `(fn (string number number) : string)` |
| `len` | `(fn (string) : number)` |
| `contains?` | `(fn (string string) : bool)` |
| `split` | `(fn (string string) : (Array string))` |

### 11.3 配列

| 名前 | 型 |
|---|---|
| `array` | `(fn (T ...) : (Array T))` |
| `nth` | `(fn ((Array T) number) : (Option T))` |
| `count` | `(fn ((Array T)) : number)` |
| `slice` | `(fn ((Array T) number number) : (Array T))` |
| `push` | `(fn ((Array T) T) : (Array T))`（不変） |
| `concat` | `(fn ((Array T) (Array T)) : (Array T))` |
| `map` | `(fn ((Array T) (fn (T) : U)) : (Array U))` |
| `filter` | `(fn ((Array T) (fn (T) : bool)) : (Array T))` |
| `fold-left` | `(fn ((Array T) U (fn (U T) : U)) : U)` |
| `find` | `(fn ((Array T) (fn (T) : bool)) : (Option T))` |
| `any?` `all?` | `(fn ((Array T) (fn (T) : bool)) : bool)` |

### 11.4 Result

| 名前 | 型 |
|---|---|
| `ok` | `(fn (T) : (Result T E))` |
| `err` | `(fn (E) : (Result T E))` |
| `bind` | `(fn ((Result T E) (fn (T) : (Result U E))) : (Result U E))` |
| `map-result` | `(fn ((Result T E) (fn (T) : U)) : (Result U E))` |
| `traverse` | `(fn ((Array T) (fn (T) : (Result U E))) : (Result (Array U) E))` |

### 11.5 オブジェクト

| 名前 | 型 |
|---|---|
| `obj` | 特殊フォーム（構築） |
| `o.a` | ドット記法（§2.3）。Field への唯一の糖衣。`field` 関数は存在しない |

P0の標準ライブラリは上記のみ。decimal、effect、defn! の完全実装は P1。

---

## 12. JavaScript バックエンド

### 12.1 出力形式

- ESM（`.mjs` または `"type": "module"` の `.js`）。
- 1 `.lts` → 1 `.js` + 1 `.js.map`。
- 依存関係は相対 import にそのまま写像。

### 12.2 型消去

型注釈・type 定義・effect 宣言はすべて消去（MUST）。ランタイムには現れない。

### 12.3 シンボル名

- kebab-case → snake_case（MUST）：`add-money` → `add_money`。
- 末尾 `?` → `_q`：`contains?` → `contains_q`。
- 末尾 `!` はエフェクト呼び出しの記法であり、効果名自体（`log` → host キー `log`）に写像する（P1）。
- JS 予約語との衝突は `$` プレフィックスで回避：`class` → `$class`。
- ユーザー定義と stdlib の衝突は stdlib 側を `$stdlib_<name>` にリネームして解決する。

### 12.4 Core IR の lowering

| Core | JS |
|---|---|
| Lit | リテラル |
| Var | 変数参照 |
| Lam | `function`（またはアロー） |
| App | 関数呼び出し |
| Let | `const name = ...;` |
| If | `if ... else` |
| Match | `switch`（tag 分解）or if 連鎖。スクルティニーは一度だけ評価 |
| Obj | `{ field: value }` |
| Field | `obj.name` |
| Do | 早期リターン（`if (r.tag === "Err") return r;`） |
| EffectCall | `await host.name(args)`（P1） |

### 12.5 runtime.js

3つのexportのみ（MUST）：

```javascript
export const ok  = (value) => ({ tag: "Ok",  value });
export const err = (value) => ({ tag: "Err", value });
export function structuralEqual(a, b) { /* 再帰的等価 */ }
```

`bind`・`map-result`・`traverse` は生成コードにインライン展開（runtimeに置かない）。

### 12.6 ホストインターフェース（P1）

```javascript
// 利用側が注入
const host = {
  db:  async (op, key) => ...,
  log: async (s) => ...,
};
```

グローバル注入は禁止（MUST）。defn! の第一引数として明示的に渡す。

---

## 13. 受入テスト（P0完了条件）

以下をすべて満たすことをP0完了とする。テスト用ソースは付録Bに集約する。

- **T1. 純粋関数とResult** — 付録A `add-money` が型検査を通り、JS出力の `add_money` が期待値を返す。
- **T2. 網羅性検査** — 付録B stock.lts（`OutOfStock` アーム欠落）で non-exhaustive エラーと fix テンプレートが出る。
- **T3. do の早期リターン** — 付録A `place-order` で `check-items` が Err を返す場合、`total` が呼ばれずに Err が返る（呼び出し回数で検証）。
- **T4. モジュール** — 付録A money.lts / cart.lts が import して型検査・実行できる。付録B cycle-a/b は module-cycle エラー。
- **T5. パーサ回復** — 付録B broken.lts で `ok` は定義され、`broken` にのみエラー。
- **T6. エフェクト違反（検査のみ）** — 付録B effects.lts の `pure-run` 内 `log!` が effect-violation エラーと `defn!` への fix パッチを返す。
- **T7. 差分一致** — T1–T6 すべてで、Rust インタープリタと JS バックエンドの出力が構造的に一致。
- **T8. source map** — JS実行時エラー（深い再帰によるスタックオーバーフロー等）のスタックトレースが .lts の該当行を指す。
- **T9. REPL JSON** — eval / test / type-of のJSON入出力が仕様通りに動作。prop は unsupported エラーを返す。

（v0.1 の「prop の反例と縮小」は P1 受入へ繰延。）

---

## 14. ロードマップ（P1以降、非規範的）

| フェーズ | 追加機能 | 変更点 |
|---|---|---|
| P1 | defn! 完全実装、effect、do-io、decimal、**prop評価（反例生成・縮小、fast-check相当）** | host DI、モックhost |
| P2 | condition system（制限付き）、restart-case、handle、`!throws` | コールバック方式、REPLデバッガ |
| P3 | 増分コンパイル、LSP、ジェネリクス本格化（ユーザー型変数）、FFI標準 | 関数単位キャッシュ |
| P4 | WASMバックエンド（GC + Stack Switching）、完全なリスタート | サンドボックス、決定性 |
| P5 | ネイティブAOT（WASM経由）、Rust/Cバックエンド（需要次第） | 性能 |

---

## 15. 非目標（明示的に含まない）

- マクロ、リーダマクロ
- eval、実行時コード生成
- クラス、継承、this
- 暗黙の型変換
- デフォルト引数、オーバーロード（同名・引数型で分散する定義）
- any、キャスト、脱出ハッチ
- イメージベース配備
- 動的型付け
- 循環モジュール依存
- グローバル状態（ホストDIで代替）

---

## 16. バージョニング

- 本書は **v0.2 (P0) Rust Edition**。言語規定は v0.2 テキスト版と同一（§0.2）。
- P1 完了時に v0.3。
- 各フェーズ完了時に仕様の該当節を更新する。

---

## 付録A. 完全な例

```lisp
;; money.lts
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

(prop "add-money commutative"
  (forall [(a : number) (b : number)]
    (= (add-money (obj (amount a) (currency "JPY"))
                  (obj (amount b) (currency "JPY")))
       (add-money (obj (amount b) (currency "JPY"))
                  (obj (amount a) (currency "JPY"))))))
;; prop はP0では受理のみ。評価はP1
```

```lisp
;; cart.lts
(import "./money.lts" (Money add-money zero))

(type CartItem
  (obj (id : string) (price : Money) (qty : number)))

(type OrderError
  (union
    (obj (tag "EmptyCart"))
    (obj (tag "NegativeQty") (id : string))))

;; place-order の戻り値エラー型。do の全 bind のエラー型は
;; ここで unify される（check-items=OrderError、total=string）
(type PlaceError (union OrderError string))

(export place-order)

(defn check-items (items : (Array CartItem)) : (Result nil OrderError)
  (if (= (count items) 0)
    (err (obj (tag "EmptyCart")))
    (match (find items (fn (i : CartItem) : bool (< i.qty 0)))
      ;; (Option CartItem) = (union CartItem nil)
      ;; 失敗ケースは nil。None タグは存在しない（§3.3）
      [nil (ok nil)]
      [i (err (obj (tag "NegativeQty") (id i.id)))])))

(defn total (items : (Array CartItem)) : (Result Money string)
  (fold-left
    items
    (ok (zero))
    (fn (acc : (Result Money string)) (i : CartItem) : (Result Money string)
      (bind acc (fn (m : Money) : (Result Money string)
                  (add-money m (obj (amount (* i.price.amount i.qty))
                                    (currency i.price.currency))))))))

(defn place-order (items : (Array CartItem)) : (Result Money PlaceError)
  (do
    [_ (check-items items)]
    [t (total items)]
    (ok t)))

(example (place-order (array))
  => (err (obj (tag "EmptyCart"))))
```

---

## 付録B. 受入テスト用ソース

```lisp
;; B-1 stock.lts（T2 用：網羅性欠落）
(type StockError
  (union
    (obj (tag "OutOfStock"))
    (obj (tag "PriceChanged") (new-price : number))))

(export show-error)

(defn show-error (e : StockError) : string
  (match e
    [(obj (tag "PriceChanged") (new-price p))
     (str-concat "price changed: " (str p))]))
;; ↑ OutOfStock アーム欠落 → non-exhaustive
;;   期待 fix: path "(defn show-error).arms" へ
;;   [(obj (tag "OutOfStock")) "..."] の insert テンプレート
```

```lisp
;; B-2 effects.lts（T6 用：エフェクト違反）
(effect log : (fn (s : string) : nil))

(defn pure-run (x : number) : (Result number nil)
  (do
    [_ (log! (str x))]
    (ok x)))
;; ↑ defn（純粋）内の log! → effect-violation
;;   期待 fix: path "(defn pure-run)" へ
;;   (defn! pure-run ...) への replace テンプレート
```

```lisp
;; B-3 broken.lts（T5 用：パーサ回復）
(defn broken (x : number) : number
  (if (< x 0) (- 0 x) x
   ;; ↑ 閉じ括弧不足 → 強制クローズ、broken にのみ parse-error
(defn ok (x : number) : number
  (+ x 1))
;; 期待: ok は通常どおり定義される
```

```lisp
;; B-4 cycle-a.lts（T4 用：循環参照）
(import "./cycle-b.lts" (f))
(defn g (x : number) : number (f x))

;; cycle-b.lts
(import "./cycle-a.lts" (g))
(defn f (x : number) : number (g x))
;; 期待: module-cycle エラー
```

---

## 付録C. Rust実装への規範的写像（本版の付加情報）

言語規定に追加を与えない、実装への写像メモ。

1. **命名の調整**（予約語・std型との衝突回避。意味論不变）：
  - `If` の `else` → `else_`
  - `Type::String` → `Type::Str`、`Type::Result` → `Type::ResultT`、`Type::Fn` → `Type::FnT`
2. **構造の追加**：`Pat` に `span` を持たせる（回復診断・fix の ASTパス安定化のため）。テキスト版にはない唯一の追加。
3. **決定性**：出力順が意味する箇所は `BTreeMap` かソート反復。serde_json の `preserve_order` は無効（デフォルト＝キーソート）。乱数・システム時刻・環境変数に依存しない。
4. **IEEE754**：`f64` は IEEE754 binary64 であり JS number と同一。インタープリタと JS の差分一致（T7）は数値演算で自然に成立する。
5. **`str` の `Ord` は UTF-8 バイト順**：§6.2 の「正規表示バイト列辞書順」ソートは Rust の文字列比較で直接実装できる。
6. **Value::Ok / Err と JS**：インタープリタ内では専用バリアント、JS では `{tag:"Ok"|"Err", value}`。lowering が対応を保証し、構造的等価は保存される。
7. **serde の `rc` feature**：`Rc<str>` の直列化に必要（Cargo.toml で `serde = { version = "...", features = ["rc"] }`）。
8. **エラー取り扱い**：ライブラリ経路で `unwrap`/`expect`/パニックを置かない。回復不能は internal-error 診断へ。`unreachable!` は列挙網羅用に限る。
9. **実装規約の詳細**（依存、unsafe 禁止、モジュール構成、テスト戦略）は `GUIDE.md`（Rust版）が規範。

---

End of Specification v0.2 (P0) — Rust Edition