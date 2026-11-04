# λ LisTS P0 実装 開発ガイド（Codestral向け / Rust）

この文書は λ LisTS コンパイラの P0 プロトタイプを Codestral（Rust）で実装するための**常設コンテキスト**です。各マイルストーンのプロンプトは別文書（プロンプト集）にあります。両方をリポジトリに置き、最初にこの順で読ませてください：

1. `SPEC.md`（λ LisTS 仕様書 v0.2 全文 — 別途リポジトリに配置）
2. この `GUIDE.md`

---

## 1. あなたの役割

あなた（Codestral）は λ LisTS の P0 コンパイラを Rust で実装するエンジニアです。仕様書 v0.2 が唯一の規範です。仕様に書かれていないものを作らない。書かれているものは仕様の言葉（MUST/SHOULD/MAY）どおりに作る。

- **仕様に無い機能は作らない**（マクロ、ジェネリクス構文、decimal、defn! の完全実装は範囲外）
- **判断に迷ったら仕様書の該当節を引用して判断する**。それでも不明なら、実装を止めず TODO コメント + `internal-error` 診断に落とす
- テストを先に書き（TDD）、コミット単位はマイルストーン内のタスクごとに小さく保つ

## 2. λ LisTS とは（要約）

- S式ベースの静的型付け純粋関数型言語（P0）。AI生成コードの規律を機械的に守るための言語
- **純粋性を構文で分離**：`defn`（純粋・エフェクト禁止）と `defn!`（P0は宣言のみ）
- 型は双方向（infer/check）。構造的等価、obj幅部分型、union正規化、文字列リテラル型（tag）
- `do` は Result の早期リターン構文（末尾位置限定）
- エラーは構造化 JSON Diagnostic + **fix パッチテンプレート**（特定 kind は MUST）
- バックエンドは JavaScript（ESM + source map v3）

なお、ここでの「Rust」は**コンパイラの実装言語**であり、言語のバックエンドターゲット（P5）とは無関係。生成物は引き続き JS。

## 3. 実装技術（固定）

| 項目 | 決定 | 理由 |
|---|---|---|
| 実装言語 | **Rust（edition 2021, MSRV 1.75+）** | enum + 網羅的パターンマッチが Core IR と同型。null・キャスト・暗黙変換が存在しない。単一バイナリ配布 |
| ビルド/テスト | cargo / `cargo test` | 標準構成 |
| 依存関係 | `serde`（derive）, `serde_json`, `thiserror`, `clap`（derive, v4）, `sourcemap`（v3生成）**のみ許可**。他の依存追加は禁止 | ツール出力の決定性を守る |
| Node.js ≥ 20 | **生成JSの実行専用**（差分テスト・source map検証）。コンパイラ自体は Node に依存しない | SPEC §12 の出力を検証するため |
| 乱数・時刻 | ツール経路に一切使わない | 決定性（§6参照）。P0に prop 評価はない |

serde_json の `Map` はデフォルトでキーがソート済み（`preserve_order` 機能を**無効のまま**にすること）— 診断JSONの決定性が自動的に得られる。

## 4. リポジトリ構成（固定・フラット構成）

```
lists/
├── SPEC.md                  # λ LisTS 仕様書 v0.2 全文（規範）
├── GUIDE.md                 # この文書
├── PROMPTS.md               # マイルストーンプロンプト集
├── Cargo.toml
├── src/
│   ├── main.rs              # CLIエントリ（clap）
│   ├── lib.rs               # pub mod 宣言
│   ├── span.rs              # Span
│   ├── diagnostic.rs        # Diagnostic, Patch, ASTパス
│   ├── token.rs             # Token 型
│   ├── lexer.rs             # §2
│   ├── ast.rs               # Surface AST（トリビア含む）
│   ├── parser.rs            # §3 ベストエフォート回復
│   ├── ir.rs                # Core IR（SPEC §5）
│   ├── desugar.rs           # §4 の決定的脱糖
│   ├── types.rs             # Type, Scheme, 正規化, 正規表示（§6.1–6.2）
│   ├── unify.rs             # §6.4（rank-1型変数）
│   ├── check.rs             # §6.3 双方向型付け
│   ├── stdlib.rs            # stdlib の Scheme 登録（§11）
│   ├── exhaustive.rs        # §6.5 Maranget-lite
│   ├── effects.rs           # §7.4 検査のみ
│   ├── resolver.rs          # import 解決・export検査・循環検出
│   ├── value.rs             # Value, Closure, structuralEqual（§8.2–8.3）
│   ├── eval.rs              # §8 正格評価, do早期リターン, example実行
│   ├── emit.rs              # §12.4 lowering
│   ├── runtime.rs           # runtime.js を include_str! で埋め込む
│   ├── backends.rs          # Backend トレイト + js/mock バックエンド（M13: 差分テストの一般化）
│   ├── sourcemap_out.rs     # sourcemap クレートによる v3 生成
│   ├── fmt.rs               # §10.3 一意フォーマッタ
│   └── repl.rs              # §10.1 JSON Lines
└── tests/                   # 統合テスト（cargo の tests/）
    ├── fixtures/            # 付録A/B の .lts を置く
    ├── golden/              # スナップショット（診断JSON・JS出力）
    └── acceptance/          # T1–T9 差分テスト（§13）
```

`src/backend/runtime.js` を実ファイルとして置き、`src/runtime.rs` から `include_str!("backend/runtime.js")` で埋め込む（編集可能性と単一情報源を両立）。

## 5. データ構造の規約

`SPEC.md` §5（Core IR）、§6.1（Type/Scheme）、§9.2（Diagnostic/Patch）の定義を Rust の enum として**直接**写す。改変禁止。

- **すべてのAST/Coreノードに `span: Span` を持たせる**（MUST）。回復で合成したノードも span を持つ
- Span = `{ file: Rc<str>, start: usize, end: usize, line: usize, col: usize }`。start/end は**バイト位置**、line/col は1始まりで col は **Unicodeスカラー値換算**（UTF-8 は `char_indices` で走査する）
- コメントは破棄せず `Trivia { leading: Vec<Comment> }` として次フォームに付属（§2.4）。ファイル末尾コメントは Program ノードへ
- Diagnostic/Patch は `serde::Serialize/Deserialize` を導出。エラーメッセージ `message` は日本語。`data` に `expected`/`actual`（§6.2 の正規表示）を入れる
- fix テンプレートの `path` は §10.2 の ASTパス形式

## 6. 決定性の規約（最重要）

このプロジェクトの出力は**全て決定的でなければならない**。

- 同じ入力 → 同じ Diagnostic JSON、同じ JS、同じフォーマット結果
- `HashMap` を**そのまま反復して出力に使わない**。出力順が意味を持つ箇所は `BTreeMap` か、キーをソートしてから反復する
- 乱数・システム時刻・環境変数・ホームディレクトリに依存しない（REPLを除く対話的状態）
- ゴールデンファイルの期待値更新は `UPDATE_SNAPSHOTS=1 cargo test` でのみ行う

## 7. テスト戦略

1. **単体テスト**：各モジュールの `#[cfg(test)]` に最小ケース（レキサ・unify など細粒度の規則）
2. **ゴールデンテスト**：`tests/golden/` — fixtures の診断JSON / JS出力 / フォーマット結果を正規JSON（ソート済みキー）で比較
3. **差分テスト（T7）**：付録A/B の各 example を (1) Rustインタープリタ (2) `node` での生成JS実行 の両方で評価し、`structural_equal` で一致を検証
4. **受入（§13）**：T1〜T9 を `tests/acceptance/` に自動化。M11 で全緑がP0完了

Node 実行は `std::process::Command` で `node --enable-source-maps` を呼ぶ（テスト専用ヘルパーを1箇所に置く）。

## 8. マイルストーン概要（詳細は PROMPTS.md）

| # | 内容 | 受入の目安 |
|---|---|---|
| M0 | スキャフォールド | `cargo test` が空テストで通る |
| M1 | レキサ（span・コメントトリビア・演算子トークン） | §2 の全トークンを字象 |
| M2 | パーサ（回復・Errorノード・型構文・パターン） | 付録A をパース、broken.lts で回復 |
| M3 | 脱糖 → Core IR | 付録A の IR が §4 の表どおり |
| M4 | 型検査（双方向・unify・rank-1・リテラル型・正規表示） | type-of のゴールデン |
| M5 | 網羅性検査 + fix | stock.lts の non-exhaustive + 不足アーム |
| M6 | エフェクト検査 + モジュール解決 | effects.lts 違反、cycle 検出 |
| M7 | インタープリタ（example実行・do早期リターン） | 付録A example 全通過 |
| M8 | JSコードgen + runtime.js + sourcemap | 生成JS実行で付録A一致 |
| M9 | CLI + REPL + フォーマッタ | JSON Lines 往復、fmt 冪等 |
| M10 | 差分一致ハーネス | T1–T7 自動緑 |
| M11 | 受入 T1–T9 締めくくり | §13 全項目緑 |
| M12 | proper tail call 定数スタック（§8.5 MUST） | 10^6 自己/相互再帰が interp/JS 双方で成功 |
| M13 | Backend トレイト + `--backend` + モック | diff テストが任意バックエンドで実行可能（LISTS_BACKEND） |

## 9. 守ってはいけないこと

- **`unsafe` は全禁止**。不要であり、発見されたら即修正
- **ライブラリ経路での `unwrap`/`expect`/パニックを禁止**（`unreachable!` は列挙網羅用に限り可）。回復不能な内部状態は `internal-error` 診断（§9.1）に変換して返す。テストコード内は可
- `anyhow` 等のエラーの型消去は使わない。エラーは Diagnostic として構造化する
- 仕様の範囲外実装（`any` 相当、キャスト、マクロ、ユーザー型変数、可変長 `+`、defn! のJS生成）
- 依存の追加（§3 許可リスト以外）
- 出力への `HashMap` 直接反復（§6）
- 仕様と実装が食い違った場合：実装を正とせず、必ず SPEC.md に立ち返り、ズレをコメントで明示して次のセッションでユーザーに報告する