use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

use lists::check::{check_file, ModuleCache};
use lists::desugar::{desugar, CoreDef};
use lists::diagnostic::{DiagKind, Diagnostic};
use lists::emit::{emit, EmitInput, EmitOutput};
use lists::lexer::tokenize;
use lists::parser::parse_program;
use lists::runtime::RUNTIME_JS;

fn fixture_path(name: &str) -> String {
    format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"))
}

fn pipeline(abs: &str) -> (Vec<CoreDef>, Vec<Diagnostic>) {
    let src = std::fs::read_to_string(abs).expect("fixture readable");
    let lex = tokenize(&src, abs);
    let (program, mut diags) = parse_program(&lex);
    let (defs, ds_diags) = desugar(&program);
    diags.extend(ds_diags);
    (defs, diags)
}

fn emit_fixture(base: &str) -> Result<EmitOutput, Vec<Diagnostic>> {
    let abs = fixture_path(&format!("{base}.lts"));
    let (defs, diags) = pipeline(&abs);
    assert!(diags.is_empty(), "{base}: {diags:?}");
    let mut cache = ModuleCache::default();
    let checked = check_file(&abs, &mut cache);
    assert!(
        checked.diagnostics.is_empty(),
        "{base}: {:?}",
        checked.diagnostics
    );
    let type_names: BTreeSet<String> = checked.type_aliases.keys().map(|k| k.to_string()).collect();
    emit(&EmitInput {
        defs,
        file: format!("{base}.js"),
        source_file: format!("{base}.lts"),
        type_names,
    })
}

fn emit_src(src: &str, file: &str) -> Result<EmitOutput, Vec<Diagnostic>> {
    let lex = tokenize(src, "test.lts");
    let (program, _) = parse_program(&lex);
    let (defs, _) = desugar(&program);
    emit(&EmitInput {
        defs,
        file: file.to_string(),
        source_file: "test.lts".to_string(),
        type_names: BTreeSet::new(),
    })
}

fn write_out(dir: &Path, name: &str, out: &EmitOutput) {
    std::fs::write(dir.join(format!("{name}.js")), &out.js).expect("write js");
    std::fs::write(dir.join(format!("{name}.js.map")), &out.map).expect("write map");
    std::fs::write(dir.join("runtime.js"), RUNTIME_JS).expect("write runtime");
}

fn run_node(dir: &Path, args: &[&str]) -> Output {
    Command::new("node")
        .args(args)
        .current_dir(dir)
        .output()
        .expect("node を起動できること (Node.js >= 20 が必要)")
}

fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("lists-m8-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("temp dir");
    dir
}

fn assert_golden(label: &str, actual: &str) {
    let path = format!("{}/tests/golden/{label}", env!("CARGO_MANIFEST_DIR"));
    if std::env::var("UPDATE_SNAPSHOTS").is_ok() {
        std::fs::write(&path, actual).expect("write golden");
    }
    let expected = std::fs::read_to_string(&path)
        .unwrap_or_else(|_| panic!("golden がありません: {path} (UPDATE_SNAPSHOTS=1 cargo test で生成)"));
    assert_eq!(expected, actual, "{path}");
}

#[test]
fn money_emit_is_deterministic_and_snapshot() {
    let r1 = emit_fixture("money").expect("emit money");
    let r2 = emit_fixture("money").expect("emit money again");
    assert_eq!(r1.js, r2.js, "JS は決定的であること");
    assert_eq!(r1.map, r2.map, "source map は決定的であること");
    assert!(r1.js.contains("export function add_money("), "{}", r1.js);
    assert!(r1.js.contains("export function zero("), "{}", r1.js);
    assert!(
        r1.js.contains("import { ok, err, structuralEqual } from \"./runtime.js\";"),
        "{}",
        r1.js
    );
    assert!(r1.js.contains("const $stdlib_str_concat"), "{}", r1.js);
    assert!(r1.js.contains("const $stdlib_add"), "{}", r1.js);
    assert!(r1.js.contains("sourceMappingURL=money.js.map"), "{}", r1.js);
    let map_json: serde_json::Value = serde_json::from_str(&r1.map).expect("map json");
    assert_eq!(map_json["version"], 3);
    assert_eq!(map_json["sources"], serde_json::json!(["money.lts"]));
    assert_golden("money.js", &r1.js);
    assert_golden("money.js.map", &r1.map);
}

#[test]
fn cart_emit_imports_money_and_do_early_return() {
    let cart = emit_fixture("cart").expect("emit cart");
    assert!(
        cart.js.contains("import { add_money, zero } from \"./money.js\";"),
        "{}",
        cart.js
    );
    assert!(cart.js.contains(".tag === \"Err\") return $r"), "{}", cart.js);
    assert_golden("cart.js", &cart.js);
    assert_golden("cart.js.map", &cart.map);
}

#[test]
fn money_js_runs_example_in_node() {
    let out = emit_fixture("money").expect("emit money");
    let dir = temp_dir("money");
    write_out(&dir, "money", &out);
    let r = run_node(&dir, &["money.js"]);
    let stdout = String::from_utf8_lossy(&r.stdout);
    assert_eq!(
        r.status.code(),
        Some(0),
        "stderr: {}",
        String::from_utf8_lossy(&r.stderr)
    );
    assert!(stdout.contains("example 0: ok"), "{stdout}");
    assert!(stdout.contains("\"tag\":\"Ok\""), "{stdout}");
    assert!(stdout.contains("\"amount\":3"), "{stdout}");
    assert!(stdout.contains("\"currency\":\"JPY\""), "{stdout}");
}

#[test]
fn cart_js_runs_empty_cart_err_in_node() {
    let money = emit_fixture("money").expect("emit money");
    let cart = emit_fixture("cart").expect("emit cart");
    let dir = temp_dir("cart");
    write_out(&dir, "money", &money);
    write_out(&dir, "cart", &cart);
    let r = run_node(&dir, &["cart.js"]);
    let stdout = String::from_utf8_lossy(&r.stdout);
    assert_eq!(
        r.status.code(),
        Some(0),
        "stderr: {}",
        String::from_utf8_lossy(&r.stderr)
    );
    assert!(stdout.contains("example 0: ok"), "{stdout}");
    assert!(stdout.contains("\"tag\":\"Err\""), "{stdout}");
    assert!(stdout.contains("\"tag\":\"EmptyCart\""), "{stdout}");
}

#[test]
fn defn_bang_module_is_emit_error() {
    let r = emit_src(
        "(effect log : (fn (s : string) : nil))\n(defn! f (s : string) : nil (log! s))",
        "test.js",
    );
    let errs = r.expect_err("defn! モジュールはエラーのはず");
    assert!(errs
        .iter()
        .any(|d| d.kind == DiagKind::UnsupportedInP0 && d.message.contains("defn!")));
}

#[test]
fn t8_deep_recursion_stack_trace_points_to_lts_line() {
    let out = emit_fixture("fact").expect("emit fact");
    let dir = temp_dir("t8");
    write_out(&dir, "fact", &out);
    std::fs::write(dir.join("run.js"), "import { fact } from \"./fact.js\";\nfact(100000);\n")
        .expect("write run.js");
    let r = run_node(&dir, &["--enable-source-maps", "run.js"]);
    let stderr = String::from_utf8_lossy(&r.stderr);
    assert_ne!(r.status.code(), Some(0), "スタックオーバーフローで失敗するはず: {stderr}");
    assert!(
        stderr.contains("Maximum call stack size exceeded"),
        "{stderr}"
    );
    let hit = stderr.find("fact.lts:").map(|i| {
        stderr[i..]
            .chars()
            .nth("fact.lts:".len())
            .is_some_and(|c| c.is_ascii_digit())
    });
    assert_eq!(hit, Some(true), "トレースに fact.lts:<行> が必要: {stderr}");
}
