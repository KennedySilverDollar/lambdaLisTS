use lists::desugar::{desugar, CoreDef};
use lists::diagnostic::Diagnostic;
use lists::lexer::tokenize;
use lists::parser::parse_program;

fn fixture_src(name: &str) -> String {
    let path = format!("{}/tests/fixtures/{}", env!("CARGO_MANIFEST_DIR"), name);
    std::fs::read_to_string(&path).expect("fixture readable")
}

fn desugar_fixture(name: &str) -> (Vec<CoreDef>, Vec<Diagnostic>) {
    let src = fixture_src(name);
    let lex = tokenize(&src, name);
    let (program, parse_diags) = parse_program(&lex);
    assert!(parse_diags.is_empty(), "{name}: {parse_diags:?}");
    desugar(&program)
}

fn def_kind(def: &CoreDef) -> &'static str {
    match def {
        CoreDef::Defn { .. } => "defn",
        CoreDef::Type { .. } => "type",
        CoreDef::Effect { .. } => "effect",
        CoreDef::Prop { .. } => "prop",
        CoreDef::Example { .. } => "example",
        CoreDef::Import { .. } => "import",
        CoreDef::Export { .. } => "export",
        CoreDef::Error { .. } => "error",
    }
}

fn def_label(def: &CoreDef) -> String {
    let path = match def {
        CoreDef::Defn { path, .. }
        | CoreDef::Type { path, .. }
        | CoreDef::Effect { path, .. }
        | CoreDef::Prop { path, .. }
        | CoreDef::Example { path, .. }
        | CoreDef::Error { path, .. } => path.clone(),
        CoreDef::Import { .. } => "(import)".to_string(),
        CoreDef::Export { .. } => "(export)".to_string(),
    };
    path.trim_start_matches('(')
        .trim_end_matches(')')
        .replace([' ', '.'], "_")
}

fn check_fixture(fixture: &str, expected_kinds: &[&str]) {
    let (defs, diags) = desugar_fixture(fixture);
    assert!(diags.is_empty(), "{fixture}: {diags:?}");
    let kinds: Vec<&str> = defs.iter().map(def_kind).collect();
    assert_eq!(kinds, expected_kinds, "{fixture}");
    for def in &defs {
        let label = def_label(def);
        let path = format!(
            "{}/tests/golden/{fixture}.{label}.json",
            env!("CARGO_MANIFEST_DIR")
        );
        let actual = serde_json::to_value(def).expect("serialize def");
        if std::env::var("UPDATE_SNAPSHOTS").is_ok() {
            let pretty = serde_json::to_string_pretty(&actual).expect("pretty");
            std::fs::write(&path, format!("{pretty}\n")).expect("write golden");
        }
        let content = std::fs::read_to_string(&path)
            .unwrap_or_else(|_| panic!("golden がありません: {path} (UPDATE_SNAPSHOTS=1 cargo test で生成)"));
        let expected: serde_json::Value = serde_json::from_str(&content).expect("golden json");
        assert_eq!(actual, expected, "{path}");
    }
}

#[test]
fn money_lts_ir_golden() {
    check_fixture("money.lts", &["type", "export", "defn", "defn", "example", "prop"]);
}

#[test]
fn cart_lts_ir_golden() {
    check_fixture(
        "cart.lts",
        &[
            "import", "type", "type", "type", "export", "defn", "defn", "defn", "example",
        ],
    );
}

#[test]
fn desugar_is_deterministic() {
    for fixture in ["money.lts", "cart.lts"] {
        let (d1, g1) = desugar_fixture(fixture);
        let (d2, g2) = desugar_fixture(fixture);
        assert_eq!(d1, d2, "{fixture}: defs should be deterministic");
        assert_eq!(g1, g2, "{fixture}: diagnostics should be deterministic");
    }
}
