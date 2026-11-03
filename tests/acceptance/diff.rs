use super::common::*;
use lists::value::print_value;

#[test]
fn t7_diff_interp_vs_js_backend() {
    for name in ["money.lts", "cart.lts", "cart-spy.lts"] {
        let base = name.trim_end_matches(".lts");
        let dir = temp_dir(&format!("diff-{base}"));
        let names = if name == "money.lts" {
            vec!["money.lts"]
        } else {
            vec!["money.lts", name]
        };
        compile_to_dir(&names, &dir);

        let (defs, diags) = pipeline_file(&fixture_path(name));
        assert!(diags.is_empty(), "{name}: {diags:?}");
        let example_count = defs.iter().filter(|d| matches!(d, lists::desugar::CoreDef::Example { .. })).count();
        assert!(example_count >= 1, "{name} に example が必要");

        let js_values = node_example_values(&dir, base, example_count);
        let interp = interp_example_values(&[name]);
        assert_eq!(interp.len(), example_count, "{name}");
        assert_eq!(js_values.len(), example_count, "{name}");
        for (i, (pass, actual)) in interp.iter().enumerate() {
            assert!(*pass, "{name} example {i}: インタープリタ側が pass していない: {}", print_value(actual));
            let js_value = json_to_value(&js_values[i]);
            assert!(
                values_equal(actual, &js_value),
                "{name} example {i} が不一致:\ninterp: {}\njs:    {}",
                print_value(actual),
                serde_json::to_string_pretty(&js_values[i]).expect("json")
            );
        }
    }
}
