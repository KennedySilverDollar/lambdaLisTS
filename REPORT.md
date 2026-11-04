# REPORT.md — codestral（本エージェント）による判断・決定事項のまとめ

- 対象: PR [#5](https://github.com/KennedySilverDollar/lambdaLisTS/pull/5)（ブランチ `vibe/v03-pre-audit-349e09`）の4コミット
  - `6175de8` v0.3 pre-audit（分析専用: `analysis/v0.3-pre-audit.md`）
  - `f14d50e` M12: proper tail call の定数スタック保証
  - `fab7e63` M13: Backend トレイトによる差分テスト一般化
  - `8cb8b38` M14: バックエンド可搬性監査（`audit/backend-portability.md`）
- 規範: SPEC.md v0.2（言語規定）と GUIDE.md（実装規約）。SPEC の文言の最終採用権はユーザーにあり、意味論変更は差分提案のみ行い採用指示を待った。

---

## 1. 事前監査（pre-audit）での推奨決定（`analysis/v0.3-pre-audit.md`）

| 項目 | 推奨案 | 却下した案 | 理由（抜粋） |
|---|---|---|---|
| 末尾再帰 | (B) MUST「proper tail call は定数スタック」を v0.3 で導入 | (A) SHOULD据え置き / (C) internal-error区別のみ | バックエンド交換で意味論を変えないための核心約束。WASM `return_call` に直結 |
| 数値 | (a) 全数値 IEEE754 f64 と明記（現状の成文化） | (b) Int=i64/Float=f64（JSでBigInt化コスト大） / (c) i53（レンジ規定コスト） | 両バックエンドの単一表現・T7差分一致を最優先。2^53超の丸めは仕様上の値として受容 |
| 循環 `=` | (b) 循環検出で実行時エラー（§8.6） | (a) 非終了の明文化（同値関係を失う） / (c) 余帰納的等価（意味が変わる） | P0では循環は構成不能なので全案が観測等価。(b) なら将来の host 混入時も「止まらない」でなく定義済みエラー |
| 実行時プリミティブ | 「実行時意味論の規範は付録CのRust型、各バックエンドはその射影」という条文を提案 | — | runtime.js の3 export は §12.5 と一致することを実装と文書の両面で確認済み |

## 2. M12（末尾再帰保証）での実装決定

- **SPEC.md §8.5**: ユーザー採用済みの差分のみを反映（末尾位置の MUST 列挙 + proper tail call 定数スタック MUST）。非末尾のスタック制限条項は不変。
- **インタープリタ** (`src/eval.rs`): `eval_core` = 深さガード + 末尾ループ `eval_loop`。末尾の `App` はフレーム無消費。深さ上限 `MAX_CALL_DEPTH=10000` は非末尾ネストのみに適用（ガードを eval_core 入口に移動）。決定: 深さ上限テストは末尾再帰フィクスチャ（deep-add）から非末尾（fact）へ付け替え（監査で予見した回帰）。
- **JSバックエンド** (`src/emit.rs`): 末尾呼び出し先を解析（末尾ウォーク+SCC）。自己再帰 → `while (true)` + 引数を一時変数に評価してからの매개변수再代入 + `continue`（引数の逐次評価順序のため一時変数化）。相互再帰（SCC>1）→ `$inner` + `$thunk`/`$run` トランポリン。決定: thunk 印は `Symbol("lists.tail")` としユーザーobjの `tag` 文字列と衝突しない方式を採用。非再帰関数の生成コードは不変（golden無更新で緑）。ラムダは Normal 出力のまま（高階末尾呼び出しの定数スタック保証は対象外と明記）。
- **型検査** (`src/check.rs`): 同一ファイル内の相互再帰 defn を表現可能にするため defn 署名の事前登録を追加（import は先行処理のまま。duplicate/unbound 診断は既存テストどおり維持）。SPEC はファイル内順序を不問のため実装ギャップの修正と判断。
- **検証**: 10^6 自己/相互再帰が interp/JS 双方で成功、diff一致（新T10）、source map はループ化箇所も .lts へマップ。Node v22.23.4 実測: `count_down(1e8)` 成功、対照の非末尾 `fact(1e4)` は RangeError。

## 3. M13（Backend トレイト）での設計決定

- トレイトは仕様どおり3メソッド: `name()` / `compile(sources, out_dir) -> Result<Artifacts, Vec<Diagnostic>>` / `run(artifacts) -> io::Result<RunOutput>`。`run` は子プロセス実行で環境変数継承・stderr取り込み・exit code返却（現行の Node 実行と同一挙動を維持。タイムアウトは現行どおり設けない）
- レジストリ方式（`registry()`/`names()`/`lookup()`）で `js` と `mock` を収録。CLI は `compile --backend <name>`（デフォルト `js`、未知名は exit 2 + 診断JSON）。テストランナーは環境変数 `LISTS_BACKEND`（デフォルト `js`）
- 差分テスト（T7/T10系）は `compile_via`/`assert_diff` に集約しトレイト経由へ移行。**対象ケース・アサートは不変**
- モックバックエンド（compile=フロントエンドのみ、run=インタープリタ結果を `example N: ok <json>` で返す）で拡張性を立証（`t11` + `LISTS_BACKEND=mock` で t7/t10 が mock に対して緑を実測）
- ガイドは `docs/backends.md` に1ページ（3メソッドの契約・登録手順・差分参加手順・stdout形式の約束）

## 4. M14（可搬性監査）での決定（`audit/backend-portability.md`）

- **問題なしと確認**: Core IR/直列化の JS 非依存、runtime.js と付録Cの一致（テストで突き合わせ）、診断JSONへのJS文言混入なし、golden スナップショット方式
- **挙動不変リファクタで修正**: `js_slice_bounds`→`slice_bounds` 改名、diagnostic.rs の死コード `unimplemented!` 削除、生成JS文字列を直接検査していたテスト4箇所を挙動検査へ置換（T8のエンジンメッセージリテラルも除去）、付録C突き合わせテスト2本・診断ガードテスト1本を追加
- **M12へ分離（未変更）**: §8.6「実行時エラー＝JSエンジンの例外」のバックエンド中立化、stdlib の5件のバックエンド間食い違い（min/max NaN、len/str-slice UTF-16、str 数値表記、nth 小数添字）、`str` 印字規約

## 5. ユーザーに委ねた未決定事項（本セッションでは提案のみ）

- 数値意味論の (b) i64 / (c) i53 の採否（推奨は (a) f64現状維持）
- 循環 `=` の (c) 余帰納的等価の採否（推奨 (b)）
- §8.6 の実行時エラー定義のバックエンド中立化の差分採用
- stdlib 5件の食い違いの修正方針（実装バグ修正 vs 仕様変更）
- `str` の数値印字規約の明文化
- P1 ロードマップ（defn!完全実装、prop検査等）の着手順

## 6. 制約遵守の記録

- 依存は serde/serde_json/thiserror/clap/sourcemap のみ（Cargo.toml無変更）。`unsafe` は `#![forbid(unsafe_code)]` のまま。ライブラリ経路に unwrap/expect 追加なし（M14で死コードの `unimplemented!` をむしろ除去）
- 決定性: 新規コードは BTreeMap/BTreeSet のみで反復順に依存せず、生成JSの決定性テストは緑
- Node ≥ 20 は生成JSの実行・差分テスト専用（処理系本体は非依存）
- 外部I/F（REPL JSON Lines、診断JSON形式、CLI出力形式）は無変更
- 回帰: テスト件数 162（開始時）→ 169（M12）→ 173（M13）→ **176 全パス**（M14時点。T1–T7/T10/T11受入 + backend + golden + tools含む）

---

## 7. M16（v0.3 事前確定4項目の SPEC 反映と両バックエンド実装）

対象はユーザーにより**事前確定済みの次の4判断のみ**であり、この範囲内で SPEC.md へ直接反映した（範囲外の意味論変更は従来どおり差分提案のまま未変更）。T1–T11 は文言無変更で回帰実行した。

- **判断ゲート採用（数値f64・循環(b)・§8.6中立化）**: 上記3判断を SPEC.md 条文と実装に反映した。§0 に §0.3「v0.2 内の追補（バージョン番号は据え置き）」として変更点リストを記録し、版番号は v0.2 のままとした。

| # | 確定事項 | SPEC 反映 | 実装 |
|---|---|---|---|
| (1) | 数値は IEEE754 f64 のまま確定 | §8.6 は現行文言「IEEE754 倍精度浮動小数点数（f64。JS準拠）」を確定済み（MUST）と明記し、§14 に「i64/i53 への変更は P5（ネイティブAOT）で性能要件が発生した場合に再検討」の一行を追記（丸め・±Infinity・NaN≠NaN の明示は維持） | 変更不要（既存の f64 実装が既に規範に適合。unit test で print 規約を固定） |
| (2) | 循環構造上の `=` は循環検出で実行時エラー | §8.3 に「P0 では循環構造を作る構文がないので `=` は常に停止（MUST）。将来 host 等で循環が現れた場合は循環検出時点で実行時エラー（§8.6）」を追記し、署名を `Result<bool, EqualError>` に変更。§8.6 にも実行時エラー条項を追記 | `src/value.rs`: 比較経路上の同一値対の再訪を検出する `EqualError::Cyclic`（thiserror）付き `structural_equal`。`src/eval.rs`: `=` builtin・`run_examples` は `EvalError::Runtime` へ変換、match リテラルは従来どおり false 扱い。`src/backend/runtime.js`: `structuralEqual` に経路ベース循環検出（throw）。DAG 共有では false positive にならないことも test 済み |
| (3) | §8.6 の実行時エラー定義のバックエンド中立化 | §8.6 を書換:「P0 の実行時エラー = 実行が継続できない意味論上の事態。各バックエンドの実行時例外として観測される（JS: スタック枯渇等の実行時例外、WASM: trap 等）。例外の型名・メッセージ・スタック表現はバックエンド依存で規範外。source map が .lts 行への対応付け（T8）」 | 文言のみ（T8 の source map 検査は維持） |
| (4) | stdlib 5件+印字規約は §8.6・付録C・Rust実装を規範としJS側を修正 | §11.6 を新設（min/max は NaN でない側を返す minNum/maxNum、len は Unicode スカラ値数、str-slice/slice は char/要素単位の slice_bounds 規則、nth は添字切捨て、`str` の印字規約を全kind記述）。付録C に #10（print_value が印字の規範的写像、f64 は指数表記なし）と #11（$stdlib_* は §11.6 と一致すること）を追記。§12.5 に structuralEqual の循環検出とローカル補助関数の方針を注記。§0.2 に4点の反映済みを追記 | `src/emit.rs` の `$stdlib_*` を修正: min/max（NaN 時は他方）、len（`[...s].length`）、str-slice/slice（char 単位 + 生成コード側 `$slice_bounds`）、nth（`Math.trunc`）、str（生成コード側ローカル `$print`/`$print_num`/`$cmp_str` で Rust `print_value` 互換。f64 は `String(n)` の指数表記を位置al 展開し `-0`/`NaN`/`±Infinity` を規約どおり印字）。runtime.js の export は ok/err/structuralEqual の**3つのまま**（§12.5 MUST） |

- **テスト（すべて追記のみ）**: `tests/fixtures/stdlib-edge.lts` 新設（example 36件: stdlib 5件 + 印字規約 + 等価性）→ `tests/acceptance/diff.rs` に `stdlib_edge_diff_interp_vs_backend` を追記（T7/T10 の対象ケースは不変）。`tests/backend.rs` に (a) runtime.js の循環検出 node テスト（cyclic array/obj は throw、「DAG 共有は false positive にしない」「関数は参照等価」control 込み）、(b) stdlib-edge の emit 決定性 + 補助関数出力テストを追記。`tests/tools.rs` の診断JSONスキャン対象に stdlib-edge.lts を追記。`src/value.rs` unit test に循環検出（経路再訪で Cyclic）・同一参照は true・print_value の数値/コンテナ規約を追記。
- **回帰**: `cargo test` **183件全パス**（旧176 + 新7 = unit 4 + acceptance 1 + backend 2）。`LISTS_BACKEND=mock cargo test --test acceptance` も全パス（mock 経由の差分にも stdlib-edge が乗る）。golden（money.js / cart.js / 診断JSON 等）は**不変** — 修正した stdlib 実装を使うのが新規 fixture のみのため。
- **制約遵守**: 依存は serde/serde_json/thiserror/clap/sourcemap のみ（Cargo.toml 無変更）。`#![forbid(unsafe_code)]` のまま。ライブラリ経路に unwrap/expect 追加なし（src 走査で確認。新規コードは map_err / unwrap_or のみ）。決定性: 出力順は BTreeMap/BTreeSet のみに依存（header の補助関数は stdlib_used に応じた固定順で出力、emit 2回一致をテストで確認）。Node ≥ 20 は生成JSの実行・差分テストのみ。
- **検証コマンド**: `cargo test`（183 passed）、`LISTS_BACKEND=mock cargo test --test acceptance`、`cargo run -q -- compile tests/fixtures/stdlib-edge.lts --out <dir>` → node で全 example ok（diff テスト内で実施済み）。

- **SPEC 条文の詳細（§0.3 の3判断）**:
  - §8.6 数値: 現行文言「IEEE754 倍精度浮動小数点数（f64。JS準拠）」を確定済み（MUST）と明記し、§14 に「i64/i53 への変更は P5（ネイティブAOT）で性能要件が発生した場合に再検討」の一行を追記。
  - §8.3 に「循環構造における構造的等価」を追加: `=` は共有・循環を追跡し比較経路上の同一値対の再訪（循環）で実行時エラー（MUST）。バックエンド間対応を表で列挙（Rust interp: `Value` は所有ベースの木構造で循環表現不可能のため検出不要・発火しない／JS: 参照共有可能のため `structuralEqual` が訪問済み同一性ペア集合（WeakMap）で検出し未処理実行時例外として報告）。「P0 では言語内から循環データを構成できないため観測されない」旨を明記。検出は比較経路上のため DAG 共有は循環とみなさない。
  - §8.6 の実行時エラー定義をバックエンド中立化し対応を表で規定（JS: 未処理の実行時例外／Rust interp: internal-error 診断。例外の型名・メッセージ・スタック表現は規範外）。T8 の source map 検証は JS バックエンドにおける具体例である旨を維持。§12.5 も WeakMap による検出へ文言更新。
- **実装**: `src/backend/runtime.js` の `structuralEqual` を訪問済み同一性ペアの集合（`WeakMap<a, WeakSet<b>>`、退去時に除去して比較経路のみ保持）による循環検出へ変更し、検出時は回復不能な実行時エラー（throw）を送出。export は ok/err/structuralEqual の3つのまま（§12.5 MUST）。Rust 側は循環不可能のため実装変更不要の旨を `src/value.rs` の `structural_equal` にコメントで記録（検出コード自体は発火しない）。
- **ホスト側テスト**（言語経由では循環構成不能のためホスト側に配置）: `tests/backend.rs` の `structural_equal_throws_on_cyclic_structures` で runtime.js を直接 import し、手作りの循環（配列の自己参照・obj フィールドの自身参照・間接循環 x→y→x）で throw されることを検証。control として非循環 true・DAG 共有 true（誤検出なし）・関数は参照等価 false を確認。
- **性能**: 循環検出の通常データへのオーバーヘッドを差分テスト一式（`cargo test --test acceptance diff::`、3回計測中央値）で確認。main 8.44s → 本ブランチ 8.65s（約 +2.5%）。全 acceptance Suite でも main 約8.6s → 約8.8s（約 +2〜3%）。2割超の劣化ではないため、深さ閾値超過時に訪問集合を遅延生成する緩和案は採用せず報告のみとする。
- **回帰**: `cargo test` 183件全パス（T1–T11 文言無変更）、`LISTS_BACKEND=mock cargo test --test acceptance` も全パス。golden 無変更。依存・unsafe 禁止・ライブラリ経路の unwrap/expect 禁止は継続して遵守（Cargo.toml 無変更、`#![forbid(unsafe_code)]` 健在）。

### 残課題（差分提案のみ。本マイルストーンでは未変更）

- `split` の空区切り: Rust `"abc".split("")` は `["","a","b","c",""]`、JS は `["a","b","c"]`。§11.6 の5件の範囲外のため未修正。提案: slice_bounds と同様に §11.6 へ規約を追記して JS 側を修正する。
- `str` 印字の corner: JS lowering では Result の `{tag,value}` 形状と、`tag`/`value` の2キーのみを持つ obj が区別できない（§11.6 に注記済み）。型検査上は `=` で混同されないが、`str` では印字が一致しない場合がある。
- pre-audit 作業1の (C)（非末尾再帰の深さ上限超過を internal-error から runtime error にするか）は未採用のまま。§8.5/§8.6 は現行どおり（Rust interp は internal-error）。
- `nth`/`find` は実行時に `Ok` で包んだ値を返す一方、型は `(union T nil)` であり、cart.lts の find 成功アーム（`i.id`）は現行実行時に失敗し得る。Option の実行時表現（raw T か Ok 包みか）の規範化は別途差分提案が必要（本範囲外のため未変更・観測のみ）。
- P1 ロードマップ（defn! 完全実装、prop 検査、host DI 等）は §14 のまま。
