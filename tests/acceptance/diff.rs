use super::common::*;

// 差分テストはすべて Backend トレイト経由で実行する（M13）。
// デフォルトは js。LISTS_BACKEND=<name> で別バックエンド（例: mock）に切り替えられる。

#[test]
fn t7_diff_interp_vs_js_backend() {
    let backend = backend_from_env();
    for name in ["money.lts", "cart.lts", "cart-spy.lts"] {
        let names: Vec<&str> = if name == "money.lts" {
            vec!["money.lts"]
        } else {
            vec!["money.lts", name]
        };
        assert_diff(&*backend, &names, name);
    }
}

#[test]
fn t10_diff_deep_tail_recursion_interp_vs_js() {
    let backend = backend_from_env();
    for name in ["tail-self.lts", "tail-mutual.lts"] {
        assert_diff(&*backend, &[name], name);
    }
}

// モックバックエンド（インタープリタ結果をそのまま返す最小実装）でも
// トレイト経由の差分テストが機能することの証明。将来の WASM 追加時も同じ手順で乗る。
#[test]
fn t11_diff_via_mock_backend() {
    let backend = lists::backends::lookup("mock").expect("mock backend");
    assert_eq!(backend.name(), "mock");
    assert_diff(&*backend, &["money.lts"], "money.lts");
    assert_diff(&*backend, &["money.lts", "cart.lts"], "cart.lts");
}

// M16（v0.3 事前確定 #4）: SPEC §11.6 の規範的意味論（stdlib 5件 + 印字規約）の差分テスト。
// T7/T10 の対象ケースは不変のまま、追記のみ。
#[test]
fn stdlib_edge_diff_interp_vs_backend() {
    let backend = backend_from_env();
    assert_diff(&*backend, &["stdlib-edge.lts"], "stdlib-edge.lts");
}

// M19 (P1 defn! 完全実装): エフェクト呼び出しを含む defn! の差分テスト。
// host は defn! の第1引数として example 内で明示的に渡す（SPEC §12.6）。
#[test]
fn effect_run_diff_interp_vs_backend() {
    let backend = backend_from_env();
    assert_diff(&*backend, &["effect-run.lts"], "effect-run.lts");
}

// M16 採用済み判断: (a) (union T nil) は実行時に生値（find/nth は成功で生値 T、失敗で nil）、
// (b) split("") は Unicode スカラ値単位で空要素なし。example の `=> <生値>` で観測する。
// option-find.lts は cart.lts の find 成功アーム（NegativeQty）を実行時に通す。
#[test]
fn option_raw_and_split_diff_interp_vs_backend() {
    let backend = backend_from_env();
    assert_diff(&*backend, &["option-raw.lts"], "option-raw.lts");
    assert_diff(
        &*backend,
        &["money.lts", "cart.lts", "option-find.lts"],
        "option-find.lts",
    );
}

// M21 do-io (SPEC §3.5): 名前なし do 束縛 `(do e1 e2 ...)`。エフェクト連続実行と
// Result を返す impure 呼び出しの早期 return を interp/backend 両方で検証する。
#[test]
fn do_io_diff_interp_vs_backend() {
    let backend = backend_from_env();
    assert_diff(&*backend, &["do-io.lts"], "do-io.lts");
}

// M23 decimal: 固定小数点 SCALE=18。丸め（half-away）を含め interp と JS で同一結果になること。
#[test]
fn decimal_edge_diff_interp_vs_backend() {
    let backend = backend_from_env();
    assert_diff(&*backend, &["decimal-edge.lts"], "decimal-edge.lts");
}

// design/interp-capability.md §1.1（C1 map/set）: 基本操作・挿入順・構造的等価・永続性・
// obj->map・末尾再帰 fold（§8.5）・印字の interp/JS 差分一致。
#[test]
fn map_edge_diff_interp_vs_backend() {
    let backend = backend_from_env();
    assert_diff(&*backend, &["map-edge.lts"], "map-edge.lts");
}

// design/interp-capability.md §1.2/§3.1（C2 char + 文字列プリミティブ）: スカラー値境界（絵文字）・
// out-of-range/invalid-code の result 往復・位置ベース API のレキサー・union/match・印字の差分一致。
#[test]
fn char_edge_diff_interp_vs_backend() {
    let backend = backend_from_env();
    assert_diff(&*backend, &["char-edge.lts"], "char-edge.lts");
}
