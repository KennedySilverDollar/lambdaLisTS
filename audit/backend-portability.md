# バックエンド可搬性監査（M14）— JS-ism 遮断の棚卸し

- 目的: JS-ism（JS 実装の偶然の挙動・概念への依存）を遮断し、将来の WASM バックエンド追加が「仕様からのコード生成の追加」だけで済む状態かを確認する。**意味論を変えない監査**（変更は挙動不変のリファクタのみ）。
- 対象: `main`ブランチ時点 + M12/M13 の実装（PR #5 ブランチ）。ベースライン: `cargo test` 176件全パス。
- 参照規範: SPEC.md v0.2（§5 Core IR、§8.2 Value、§8.3 等価、§9 診断、§12 JSバックエンド、付録C）、GUIDE.md。

---

## 1. Core IR の全ノード型・全直列化形式の JS-ism 走査

**検査箇所**: `src/ir.rs`（`Core` 12 variants + `Param`/`DoBind`/`MatchArm`/`Pat`/`PatKind` とその serde 形式）、`src/ast.rs`（`LitValue` 等）、`src/types.rs`（`Type`）、`src/value.rs`（`Value`）、SPEC §5/§8.2/付録C。キーワード衝突回避（`emit.rs` の JS_RESERVED と `$` プレフィックス, SPEC §12.3）はタスク対象外として除外。

**発見**:
- `Core` のノード名・フィールド・variant に JS 概念は一切無い（`undefined`/`NaN`/`-0`/prototype/例外/オブジェクト同一性は構造に存在しない）。`else_` は Rust 予約語回避で JS とは無関係 → **問題なし**
- 直列化はすべて serde（JSON）。診断JSONが JSON なのは §9 の言語レベルの決定（機械可読性）であり JS 非依存。`Value::Obj` は `BTreeMap`（キーソート済み）で出力決定性を担保（付録C#3）→ **問題なし**
- SPEC §8.2 の `Value` 定義には「JS null」「JS `{tag:"Ok",value}` に対応」等の射影コメントがあるが、これらは §12（JSバックエンド定義）に付随する射影説明であり、**§5 Core IR 自体にはその種の記述が無い**ことを確認 → **問題なし（許容）**
- `src/eval.rs` の `fn js_slice_bounds` は命名が JS の `slice` に依拠 → **修正済み**（`slice_bounds` に改名、挙動不変）
- `value.rs` の `print_value` は NaN を `"NaN"` と印字する表示規約（`str` の一部）。数値→文字列の規約自体は意味論論点 → §6 の分離提案へ

## 2. 実行時プリミティブ（ok / err / structuralEqual）と付録Cの突き合わせ

**検査箇所**: `src/value.rs`（`structural_equal`/`print_value`）vs `src/backend/runtime.js`（ok/err/structuralEqual）vs SPEC §8.2/§8.3/§12.5/付録C#6。

**追加したテスト**:
- `src/value.rs`: `structural_equal_edge_cases_against_appendix_c` — 空obj同士・空obj vs 非空・深いネスト（配列/obj混在）・NaN≠NaN・-0==+0・Result の tag+value（ネスト含む）・型違いは false
- `tests/backend.rs`: `runtime_primitives_match_appendix_c_across_backends` — Node で `runtime.js` を実際に実行し、12エッジケース（空obj/ネスト/NaN/-0/数値/ok-ok/ok-err/nil-nil/nil-obj/str）の `structuralEqual` 結果を Rust 側 `structural_equal` と突き合わせ。あわせて `ok(1)`/`err("e")` の出力形状が §12.5 MUST の `{tag,value}` であることを検査

**結果**: 両実装は付録Cの Rust 型と一致することを確認（空obj・ネスト・数値比較すべて一致、`{tag:"Ok"|"Err", value}` 形状も一致）→ **問題なし**

## 3. テストコード中の「生成JSの文字列表現」検査

**リストと処理**:
| 箇所 | 内容 | 処理 |
|---|---|---|
| `tests/backend.rs` `money_emit_is_deterministic_and_snapshot` | `contains("export function add_money(")` 等6件の文字列検査 | **削除**（決定性・source map契約・golden は維持。実行挙動は `money_js_runs_example_in_node` で検査済み） |
| `tests/backend.rs` `cart_emit_imports_money_and_do_early_return` | import 行・`.tag === "Err") return $r` の文字列検査 | **挙動検査に置換**（money+cart をコンパイルして node 実行し Err(EmptyCart) を検査。golden は維持） |
| `tests/backend.rs` `generated_js_shape_for_tail_calls`（M12で追加） | `while (true)`/`$thunk`/`$inner` 等の文字列検査 | **置換**: `tail_call_codegen_behaves_via_backend`（Backend トレイト経由でコンパイル→node実行→結果検査） |
| `tests/backend.rs` `t8_deep_recursion_stack_trace_points_to_lts_line` | stderr の `"Maximum call stack size exceeded"` リテラル（JSエンジンメッセージ） | **除去**（exit≠0 と `fact.lts:<行>` マッピングのみ検査。T8の本質は source map 検証） |
| `tests/golden/*.js(.map)` | 生成JSの完全スナップショット | GUIDE §7.2 の意図的スナップショット（UPDATE_SNAPSHOTS運用）→ **問題なしとして維持** |
| `tests/backend.rs` の stdout `"tag":"Ok"` 等 | プログラム**出力**の検査（生成コードではない） | **問題なし** |

## 4. 診断JSONへのJS由来情報の混入

**検査**: 全フィクスチャ（money/cart/stock/effects/broken/cycle-a/mod-missing/tail-self/tail-mutual）の lex→parse→desugar→check の全診断を JSON 化し、JS エンジンマーカー（`RangeError`/`TypeError`/`SyntaxError`/`Maximum call stack`/`is not defined`/`undefined`/`prototype`）で走査。ガードテスト `tests/tools.rs::diagnostics_contain_no_js_engine_text` を追加。

**発見**:
- 診断の kind/message/data に JS 由来の文言は混入していない（メッセージはすべて日本語の独自文言）→ **問題なし**（ガードテストで継続監視）
- `src/diagnostic.rs` に `unimplemented!` の死コード `to_json_line` があり、呼び出し元が無いが GUIDE の「ライブラリ経路でパニック禁止」に抵触しうる → **修正済み**（削除）

## 5. 修正したもの（挙動不変のリファクタ。回帰: `cargo test` 176件全パス = T1–T7/T10/T11 受入 + backend/golden/tools 全緑）

1. `src/eval.rs`: `js_slice_bounds` → `slice_bounds`（命名のみ、呼び出し2箇所含む）
2. `src/diagnostic.rs`: 死コード `to_json_line`（`unimplemented!`）を削除
3. `tests/backend.rs`: 上記 §3 の4箇所を挙動検査へ置き換え（テキスト依存を除去）
4. テスト追加: 付録C突き合わせ2本（§2）、診断ガード1本（§4）、計3本

## 6. M12形式の分離提案（本マイルストンでは意味論に触れず未変更）

1. **SPEC §8.6 の「実行時エラー」定義が JS に依拠**: 現行は「P0の実行時エラーとは JS エンジンが投げる実行時例外（RangeError 等）を指す」となっており、意味論記述に JS が残っている。WASM では trap 等になるため、バックエンド中立な定義（例: 「実行時エラーは各バックエンドの実行時例外とし、JS では RangeError 等、WASM では trap」）へ変える差分を提案する（§8.6 のみ、T8 は source map 検証として存続）
2. **stdlib の JS準拠によるバックエンド間食い違い**（`analysis/v0.3-pre-audit.md` 作業2 の5件: `min`/`max` の NaN、`len`/`str-slice` の UTF-16単位対 char、`str` の数値表記（指数表記・-0）、`nth` の小数添字）: 付録C#4「数値演算で自然に一致」に反する実装バグであり、修正には意味論の確定（または実装修正）が必要なため本監査では未着手。別途修正マイルストーンへ
3. **`print_value` の数値印字規約**（`-0` → `"-0"` 等）: §11 `str` の仕様として明文化するかどうかはユーザー判断 → 提案のみ

## 7. 結論（WASM 追加時の残課題）

- Core IR / Value / 診断 / REPL プロトコルは JS 非依存であることを確認した。WASM バックエンドは M13 の `Backend` トレイト3メソッドを実装して `registry()` に登録するだけで差分テスト（T7/T10系）に参加できる（モックで経路を実証済み）
- 意味論レベルで JS に依拠しているのは **§8.6 の実行時エラー定義のみ**（分離提案 6-1）。それ以外の JS-ism は実装バグ（6-2）または文書上の射影説明（許容）
