# host DI 設計書（M21 基盤 / P1）

ステータス: 設計確定＋注入機構は実装済み（`src/host.rs`, REPL `--host`）。エフェクト実行の言語機能は M21（defn! 完全実装は M19 で済、host は defn! 第1引数として明示渡し済み §12.6）。JS バックエンド側のモック相当は設計提案のみ（未実装）。

## 1. 基本方針（採用済み前提）

- host は「能力インターフェース」: effect 宣言 `(effect name : sig)` の `name → sig` が、実装へ 1対1 に写像する。WASM ホスト関数（P4）も同じ対応表から生成できる形を保つ。
- リソース系エフェクト（予算消費・fuel 相当、P4）を後から追加しても host 設計は変えない: effect 宣言を増やすだけで、host 型・注入機構・モックはそのまま拡張される（宣言の一般性）。
- 処理系本体は特定の host 実装に依存しない。実装は外部から注入する（§12.6「グローバル注入は禁止」の interp 側の対応物: 生成 JS ではなくラン側が注入する）。

## 2. host の Rust 型

- ラン時の host 値は λ の値 `Value::Obj`（effect 名 → ハンドラ関数値）。これはそのまま defn! の第1引数に渡る（M19 実装済み、§12.6）。
- effect 宣言から host の obj 型を導出する: `host::host_type(effects) : Type`
  `(effect log : (fn (s : string) : nil))` → `(obj (log : (fn (s : string) : nil)))`。
  この型が defn! の host 引数の型と一致することを検査済み（`check_host_handlers`）。
- ハンドラの実体は `Value::Builtin` の `BuiltinKind::HostMock { effect, default, log }`（モック用）や `Value::Closure`（ユーザー定義）。

## 3. 注入点

| 注入点 | 形状 | 実装 |
|---|---|---|
| CLI / REPL 起動 | `lists repl --host none\|mock`（未知名は exit 2） | `repl::run_with_host` → `Repl::with_host_mode` |
| interp の全局環境 | `host::inject_host(&env, "host", &host_obj)` で `host` に束縛 | 実装済み |
| 検査 | `ModuleCache.host_bindings` に `host : host_type(effects)` を登録し、既知の全局として扱う（REPL で effect 宣言が読み込まれると自動更新） | 実装済み |
| テストランナー | `inject_host` を acceptance 側から呼ぶだけでよい（現状の example は host リテラルを明示渡ししているので必須ではない） | 機構のみ実装 |

REPL では effect 宣言を含む eval/reload のたびに `refresh_host` がモック host を再構築して `host` 全局へ注入し、`host-log` op で記録を JSON Lines で返す。

## 4. モック host（テスト・差分テストの基礎）

- `MockHost::from_effects(effects, aliases)`: effect ごとにハンドラを構築。呼び出しは `HostCall { effect, args }` として共有ログ `Rc<RefCell<Vec<HostCall>>>` に記録され、戻りは `default_value(ret)` の固定値。
- `default_value`（決定的・型の形のみで決定）: nil→Nil、number→0、string→""、bool→false、Array→[]、obj→各フィールド既定値、union→nil があれば Nil なければ先頭要素、Result T E→Err(E の既定値)（fail-safe）、fn 型・型変数→構築不可（その effect はモックに含めない）。
- 決定性: 同じ effect 宣言と同じ呼び出し列なら、応答も記録も常に同一（乱数なし・時刻なし）。これが「外部入力（host）が同じなら結果は同じ」の host 側の実体。

## 5. JS バックエンド側の表現（設計提案・M21 で実装予定）

- 生成 JS では host は引き続き defn! の第1引数のまま渡し、`await host.<name>(args)`（§12.4）。グローバルな host 宣言は禁止のまま（§12.6 MUST）。
- モック相当の import 形状（提案）: 生成コードからは `host` を import せず、テスト用ランナーが `host.mock.js` を差し込む形:
  ```js
  // host.mock.js（提案）
  export function mockHost(specs, log) { /* specs: effect名→既定応答 */ return { log: async (s) => { log.push(["log", s]); return null; }, ... }; }
  ```
  - `run.js` ランナーが `import { mockHost } from "./host.mock.js"; const host = mockHost([...]);` を差し込み、`host` を defn! 呼び出しへ渡す。生成モジュール自身は host を生成も import もしない。
- エフェクト呼び出しの JS 表現は現状どおり `await host.<name>(args)`。effect 名 → JS メソッド名は `js_name`（kebab→snake_case）で統一（§12.3 と obj フィールドと同じ規約）。
- WASM（P4）への写像: effect 名 → ホスト関数名の対応表を `design/host-di.md` この節と `effect` 宣言から機械生成する。リソース系（fuel）は `consume-fuel!` のような通常の effect として追加し、host 側の型を変えない。

## 6. M21 への引き継ぎ事項

1. JS 側モック host（§5 の `host.mock.js` 形状）の実装と、差分テスト（interp のモック host ログ vs JS のモック host ログの一致確認）。
2. `lists run` / backend 実行での host 注入オプション（現状は REPL のみ）。
3. リソース系エフェクト（fuel）の追加時: effect 宣言を足すだけで host 型・モック・WASM 写像が拡張されることの確認テスト。
4. `host` 全局名の衝突（ユーザーが `host` という defn を書いた場合の duplicate-definition）の挙動は現状エラーどおり。明文化は差分提案。
