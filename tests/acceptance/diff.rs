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
