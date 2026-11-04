# バックエンド実装ガイド（M13〜）

差分テストは「インタープリタ vs 任意バックエンド」で走る。新しいバックエンド（例: WASM）を追加しても、
テスト側の変更はゼロで差分対象に乗る。規約は `src/backends.rs` の `Backend` トレイト。

## Backend トレイト（実装すべき3メソッド）

```rust
pub trait Backend {
    fn name(&self) -> &str;                                                    // --backend / LISTS_BACKEND の名前
    fn compile(&self, sources: &[SourceFile], out_dir: &Path)                  // コンパイル成果物
        -> Result<Artifacts, Vec<Diagnostic>>;
    fn run(&self, artifacts: &Artifacts) -> std::io::Result<RunOutput>;       // 成果物を実行し標準出力を得る
}
```

| メソッド | 契約 |
|---|---|
| `name()` | CLI `--backend <name>` とテスト環境変数 `LISTS_BACKEND` で指定される一意な名前（例: `"js"`, `"wasm"`） |
| `compile(sources, out_dir)` | sources（.lts）を out_dir にコンパイルする。フロントエンド（lex→parse→desugar→check）は `backends::frontend` 系の共通処理を使える。診断は `Vec<Diagnostic>` で返す（現行どおり JSON kind つき）。成功時は `Artifacts { dir, entry }` を返す。`entry` は実行エントリ（js なら最後のソースの .js ファイル名、wasm なら .wasm ファイル名） |
| `run(artifacts)` | 成果物を子プロセスで実行し、`RunOutput { stdout, stderr, code }` を返す。**環境変数は子プロセスに継承し、stderr は取り込む**（現行の Node 実行と同じ挙動。タイムアウト方針も現行どおり） |

## 登録手順（これだけで差分テストに参加できる）

1. `src/backends.rs` に構造体を実装して `Backend` を impl する（例: `JsBackend`, `MockBackend` を参照）。
2. `registry()` に `Box::new(YourBackend)` を追加し、`names()` に名前を追加する。
3. 以上。`tests/acceptance/diff.rs` の T7/T10 系は `backend_from_env()`（環境変数 `LISTS_BACKEND`、デフォルト `js`）経由で自動的にそのバックエンドを差分対象にする。

```sh
cargo test --test acceptance diff::                      # デフォルト: js
LISTS_BACKEND=wasm cargo test --test acceptance diff::   # 新バックエンドで同じケースを検証
lists compile foo.lts --out out --backend wasm           # CLI からも選択できる
```

## 差分テスト参加の約束（テスト側が期待する出力形式）

- `run()` の stdout には、各 `example` の結果を1行ずつ `example <index>: ok <JSON>` の形式で出すこと
  （現行の生成JSが `console.log("example N: ok " + JSON.stringify(actual))` で出す形と同一）。
  JSON の値は `Ok`/`Err` が `{ "tag": "Ok"|"Err", "value": ... }`、`nil` は `null`（付録C準拠）。
  参考: `backends::value_to_json`。
- 失敗時は exit code != 0 または `example N: FAIL ...` を出し、stderr に理由を書くこと。
- 比較はインタープリタの `Value` と `structural_equal` で行われる（tests/acceptance/common.rs の `assert_diff`）。

## 現状のバックエンド

| 名前 | compile | run |
|---|---|---|
| `js` | `.js` + `.js.map` + `runtime.js` を out_dir へ（SPEC §12） | `node <entry>` 子プロセス（cwd = out_dir） |
| `mock` | フロントエンドのみ（ファイル出力なし） | インタープリタで example を実行し結果をそのまま返す（拡張性の立証用） |

WASM バックエンドは本マイルストンでは未実装（P4ロードマップ）。上記の手順で追加するだけで T7/T10 系の差分に乗る。
