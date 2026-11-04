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

---

## 8. M16 採用(4)詳細: stdlib 5件＋印字規約の interp/JS 食い違い修正（規範 = §8.6・§11.6・付録C・Rust実装）

M14 監査で発見された食い違いを、規範（§8.6・付録C・Rust実装）に合わせて JS 側（`src/emit.rs` の `$stdlib_*` とローカル補助関数）を修正した。仕様文言が曖昧だった箇所は §11.6 を明確化し（採用(4)の委任範囲）、§0.3 の変更点リストにも追記済み。runtime.js の export は ok/err/structuralEqual の3つのまま（§12.5 MUST）。

| 項目 | 採用規範（文言の所在） | Rust 実装の適合確認 | JS 側の修正 | 差分テスト追加 |
|---|---|---|---|---|
| 1. min/max の NaN・±0・±Infinity | §11.6（明確化）: 片方 NaN → 他方、両方 NaN → NaN。それ以外は `a<b ? a : b`（max は `a>b ? a : b`）。同値（±0含む）なら第2引数 | `src/eval.rs` の `f64::min`/`f64::max`。±0 同士の比較は LLVM 上規格未規定で debug/release で符号が異なることを実測したため、規範は「同値なら第2引数」と明記し JS も統一 | `Math.min/max`（NaN 伝搬・±0順序が不一致）をやめ、NaN チェック後に `a < b ? a : b` / `a > b ? a : b` の数値専用パスで明示実装 | `stdlib-edge.lts` に NaN・±0（4ケース）・±Infinity の str 観測を追加 |
| 2. len / str-slice の単位 | §11.6: Unicode スカラ値（char）数。サロゲートペアは 1 | `chars().count()` / `chars().collect()` で適合 | `s.length` → `[...s].length`（コードポイント換算）、str-slice も char 配列経由 + `$slice_bounds` | 絵文字 😀 の len/str-slice 境界（先頭・中間・NaN end）を追加 |
| 3. str の数値表記 | §11.6/付録C #10: 最短往復10進・指数表記なし、整数値に `.0` 無し、NaN/±Infinity/-0 は専用表記 | `print_value` は Rust `f64` Display（指数表記なし）に適合 | `String(n)` の指数表記（`1e+21` 等）を `$print_num` で展開するローカル補助関数を生成コードに埋め込み | 0, 1.0→"1", 1e15/1e16/1e20/1e22, -1e21, 2^53, 0.5, 1e-6 の境界を追加 |
| 4. nth の小数添字（＋ slice/str-slice の小数 bounds） | §11.6: `i >= 0 && trunc(i) < len` なら `ok(arr[trunc(i)])`、他は `nil`。slice_bounds の start/end も 0 方向切り捨て。nth は配列のみ（文字列は str-slice） | `i as usize`（0方向切り捨て）と `slice_bounds` の `as usize` で適合 | `Math.trunc` による切り捨て＋`$slice_bounds`（`Math.trunc` 込み） | nth に 0.5/2.99/-0.5、str-slice/slice に小数 bounds（1.9, 4.2 等）を追加 |
| 5. str の印字規約 | §11.6/付録C #10: 文字列は引用符・エスケープなしで生印字。配列 `[a b c]`、obj はキーを UTF-8 バイト順に `{k: v, ...}`、Result `(ok v)`/`(err v)`、関数 `<fn>`。REPL の結果印字（actual/expected）も同規約。診断は span/kind で示し値を示す場合は同規約 | `src/value.rs` > `print_value` が規範通り。REPL は `print_value` を使用（repl.rs） | 生成コードにローカル `$print`/`$print_num`/`$cmp_str` を埋め込み（キーはコードポイント順ソート） | 文字列の生印字（`"`・改行を含む）、ネスト構造（配列内文字列・obj 内 Result/文字列）を追加 |

- **検証**: `tests/fixtures/stdlib-edge.lts` は example 70件（旧36 + 新規34）すべて interp vs JS backend（`--backend js`）で一致し、期待値とも一致（`diff::stdlib_edge_diff_interp_vs_backend`）。`cargo test` 183件全パス、`LISTS_BACKEND=mock` でも全パス。T1–T11・golden は無変更。
- **残課題（持ち越し）**: `split("")` の空区切りの食い違い（Rust は `["","a","b","c",""]`、JS は `["a","b","c"]`）は §11.6 の5件の範囲外のため未修正。`str` 印字で JS の `{tag,value}` 形状と2キー obj が区別不能な点は §11.6 に注意として記載済み。

---

## 9. name-convention 検査の実装（スモーク S3 で発見された仕様・実装ギャップ）

- **発見経緯**: 実用確認スクリプト `scripts/lists-smoke.sh` の S3（name-convention）で、camelCase の defn 名が診断 `[]`・exit 0 で受理されることが判明（再現: `(export badName)` + `(defn badName (x : number) : number x)`）。SPEC は §2.3（シンボル名は kebab-case MUST）、§9.1（kind name-convention、フェーズ=検査）、§9.3（fix テンプレート MUST、kebab-case 変換）を要求しており、実装が追いついていなかった。なお `scripts/lists-smoke.sh` はリポジトリに存在しなかったため本件で新設した（S1–S20、S3 が name-convention: kind + `fix.template === "bad-name"` を検査）。
- **根拠条文**: §2.3（kebab-case MUST、`_` 単体はワイルドカード専用）、§9.1（name-convention は検査フェーズ）、§9.3（fix は kebab-case 変換テンプレート MUST）、§10.2（path は AST パス）、§6.6（型名前空間と値名前空間の分離）。
- **実装** (`src/names.rs`, `check_source` から検査フェーズ（AST 構築後）で実行。パーサ回復（Error ノード）とは独立に動作し、1ファイル内の全違反を報告):
  - 検出規則（値名前空間）: 大文字を含むか `_` を含む（`_` 単体は除く）場合に severity=error の name-convention。`-`・数字・末尾 `?` は正当。
  - 型名前空間（type 定義名・型位置の alias・import/export の型名）: PascalCase が規範（§6.6 と付録A/B の型名の例）なので大文字自体は違反にせず、snake_case（`_` 含む）と camelCase（小文字始まりで大文字含む）のみ違反とする。import/export 名は「大文字を含むか type_aliases に存在すれば型名」と分類し、import 失敗時の誤報を回避。
  - 対象位置: defn/defn! 名、type 名、effect 名、param 名、let/do bind 名、fn param 名、obj フィールド名（構築・パターン・型の両方）、match パターン変数名、import/export シンボル、dotted-symbol の各セグメント。
  - fix: `Patch::Replace { path, template }`、path は §10.2 の AST パス（例: `(defn badName)`、`(export).names.0`）、template は kebab 変換名（badName→bad-name、bad_name→bad-name）。
- **テスト**: unit 8件（`src/names.rs`: camelCase/PascalCase/snake_case 検出、`_` 許可、kebab 名（add-money/contains?/x2）許可、全位置の網羅検出、dotted セグメント、check_source 経由）、ゴールデン `tests/golden/name-convention.diagnostics.json`（再現ケースの診断 JSON、fix 含む）、CLI テスト `cli_compile_camel_case_exits_1_with_name_convention_and_fix`（exit 1 + kind + template）、スモーク `bash scripts/lists-smoke.sh` → **20/20（S3 PASS）**。
- **既存ソースの確認（報告事項）**: 全17 fixtures と付録A/B の全 lisp ソースを compile し name-convention 診断 0件を確認。型名の PascalCase（`Money`/`CartItem` 等）は §6.6 の型名前空間の分離と付録A/B の規範例により仕様上正当と判断したため、型名前空間には大文字ルールを適用していない（fixture は無変更）。もし型名も kebab-case に統一したい場合は別途採用指示を乞う（差分提案レベルの意味論変更のため本件では未変更）。
- **回帰**: `cargo test` 193件全パス（T1–T11 文言無変更、golden 既存ファイル無変更）、`LISTS_BACKEND=mock` acceptance 全パス、warning 0。依存・unsafe・unwrap/expect 制約は継続遵守。

---

## 10. M19 (P1 defn! 完全実装)

対象は SPEC.md がすでに P1 として規定する範囲（§7.2 eff 集合、§7.4 検査規則、§7.5、§12.3 末尾 `!`、§12.4 lowering、§12.6 host DI）。本マイルストーンでは「採用済み」と明記された新規文言がないため **SPEC.md は無変更**。T1–T11・既存ゴールデンも無変更（t6.effects.diagnostics.json を含む全ゴールデンが byte 一致で通ることを確認）。

### 実装

- **IR** (`src/ir.rs`): `Core::EffectCall` に `host: Rc<str>` を追加（囲んでいる defn! の第1引数名。defn! の外では空文字）。`src/desugar.rs` が defn! 本体の脱糖時にのみ記録する。
- **検査** (`src/effects.rs`, `src/check.rs`):
  - eff の不动点を計算し、純粋 defn がエフェクトへ到達可能なら `effect-violation`。直接の EffectCall は従来どおり span=呼び出し位置・fix=`defn!` 置換（t6 ゴールデン不変）。defn→defn! の直接呼び出しと、純粋経由の間接到達（§7.4「逆は禁止」＋§7.2 eff(defn)=∅ MUST）も呼び出し位置で `effect-violation`（同じ fix）。
  - エフェクト呼び出しを含むのに引数のない defn! → host 不足の `effect-violation`。example 等 defn! 外の EffectCall → host が無いため `effect-violation`。
  - defn! の第1引数（host）の型が obj なら、各 EffectCall のハンドラフィールドを effect 宣言シグネチャと unify で検査（`src/check.rs` `check_host_handlers`）。
  - do>bind の EffectCall は defn! 内のみ Result 要件を免除（§7.4 rule 5 の括弧書き「エフェクト呼び出しは P1 で例外的に許可」どおり）。純粋 defn では従来どおり type-mismatch も出る（t6 不変）。束縛値は interp と同じく「Ok なら中身、それ以外はそのまま」。
  - purity をモジュール間で伝播: `ModuleResult.defn_purity` を追加し import で merge（`src/check.rs`）。
- **インタープリタ** (`src/eval.rs`): EffectCall は host obj の `effect` フィールドのハンドラを apply（§12.4 と同じ host 経由）。host 未束縛・フィールド欠落は runtime error。
- **JS 生成** (`src/emit.rs`): defn! → `async function`、host は第1引数のまま渡る（§12.6「グローバル注入禁止」を維持）。EffectCall → `await host.<js_name(effect)>(args)`（§12.4）。async 文脈では App/EffectCall を `(await ...)` で包む（非同期でない値への await は恒等）。エフェクトまたは impure 呼び出しを含む lam のみ `async` arrow。do の EffectCall bind は nil-safe な Err 早期 return と Ok 時のみ `.value` 取り出し（interp と一致）。example は「モジュールが async を含むときだけ」`await` 付き（純粋モジュールの生成 JS はバイト無変更＝ money.js/cart.js ゴールデン不変）。トランポリンは async モジュールのみ `async $run`。末尾再帰の defn! は async `while(true)` ループで定数スタック（count-down 1e5 を node で実行成功）。
- **backend** (`src/backends.rs`): frontend の check cache を共有し、全モジュールの defn_purity から `impure_names` を `EmitInput` に渡す（import 先の defn! 呼び出しも await 対象）。

### 検証

- `cargo test` **201 全パス**（新規 +8: emit 3, effects 5, backend 1, diff 1。P0 時代の「defn! はエラー」系テスト 2 本を P1 挙動に書き換え）。warning 0。
- `LISTS_BACKEND=mock cargo test --test acceptance` 11/11（effect-run の diff は mock=interp 経由でも緑）。
- `bash scripts/lists-smoke.sh` **20/20**。
- `tests/fixtures/effect-run.lts`（新規: log!/db! を含む defn!、do 内エフェクト束縛、match、末尾再帰 count-down 1e5、example 3 本）を CLI `compile` → `node` で **3/3 ok**。生成 JS を 2 回コンパイルして一致（決定性）。interp vs JS の構造的一致は `diff::effect_run_diff_interp_vs_backend` で確認。
- 依存・unsafe・ライブラリ経路の unwrap/expect 追加なし（新規コードは unwrap_or_else のみ）。

### 残課題（差分提案。本マイルストーンでは SPEC 未変更・実装のみ）

1. defn! 第1引数の命名を `host` に強制する MUST 文言（現状は任意名で、その名前がそのまま JS の host 変数になる）。
2. host キーの命名: JS 側は obj フィールドと同じ `js_name`（kebab→snake_case。`db-write!` → `host.db_write`）。§12.3「効果名自体が host キー」を逐語にするなら `host["db-write"]` 形式への変更を提案。
3. example/top-level での EffectCall 禁止を明文化する文言（現状は実装が `effect-violation` を出すのみ）。
4. host の型が obj でない（型変数・別名など）場合にハンドラ検査をスキップする扱いの明文化。
5. async モジュールの example は top-level await に依存すること（ESM 前提。export/import を一切含まない純粋 async モジュールでは Node のモジュール構文検出に依存）。
