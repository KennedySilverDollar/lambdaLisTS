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

#[test]
fn tail_self_recursion_is_constant_stack_in_node() {
    let out = emit_fixture("tail-self").expect("emit tail-self");
    let dir = temp_dir("tail-self");
    write_out(&dir, "tail-self", &out);
    std::fs::write(
        dir.join("run.js"),
        "import { count_down } from \"./tail-self.js\";\nconst r = count_down(1000000, 0);\nif (r !== 1000000) throw new Error(\"unexpected: \" + r);\nconsole.log(\"count_down(1000000) = \" + r);\n",
    )
    .expect("write run.js");
    let r = run_node(&dir, &["run.js"]);
    assert_eq!(
        r.status.code(),
        Some(0),
        "10^6 の末尾自己再帰がスタックオーバーフローした: {}",
        String::from_utf8_lossy(&r.stderr)
    );
    let stdout = String::from_utf8_lossy(&r.stdout);
    assert!(stdout.contains("count_down(1000000) = 1000000"), "{stdout}");
}

#[test]
fn tail_mutual_recursion_is_constant_stack_in_node() {
    let out = emit_fixture("tail-mutual").expect("emit tail-mutual");
    let dir = temp_dir("tail-mutual");
    write_out(&dir, "tail-mutual", &out);
    std::fs::write(
        dir.join("run.js"),
        "import { is_even } from \"./tail-mutual.js\";\nconst r = is_even(1000000);\nif (r !== true) throw new Error(\"unexpected: \" + r);\nconsole.log(\"is_even(1000000) = \" + r);\n",
    )
    .expect("write run.js");
    let r = run_node(&dir, &["run.js"]);
    assert_eq!(
        r.status.code(),
        Some(0),
        "10^6 の相互再帰がスタックオーバーフローした: {}",
        String::from_utf8_lossy(&r.stderr)
    );
    let stdout = String::from_utf8_lossy(&r.stdout);
    assert!(stdout.contains("is_even(1000000) = true"), "{stdout}");
}

#[test]
fn generated_js_shape_for_tail_calls() {
    let self_out = emit_fixture("tail-self").expect("emit tail-self");
    assert!(self_out.js.contains("while (true)"), "{}", self_out.js);
    assert!(self_out.js.contains("continue;"), "{}", self_out.js);
    assert!(!self_out.js.contains("$thunk"), "{}", self_out.js);

    let mut_out = emit_fixture("tail-mutual").expect("emit tail-mutual");
    assert!(mut_out.js.contains("$thunk("), "{}", mut_out.js);
    assert!(mut_out.js.contains("function $run("), "{}", mut_out.js);
    assert!(mut_out.js.contains("is_even$inner"), "{}", mut_out.js);
    assert!(mut_out.js.contains("is_odd$inner"), "{}", mut_out.js);
    assert!(mut_out.js.contains("export function is_even("), "{}", mut_out.js);

    let fact = emit_fixture("fact").expect("emit fact");
    assert!(!fact.js.contains("while (true)"), "{}", fact.js);
    assert!(!fact.js.contains("$thunk"), "{}", fact.js);
}

#[test]
fn source_map_covers_loop_converted_tail_call() {
    let out = emit_fixture("tail-self").expect("emit tail-self");
    let map = sourcemap::SourceMap::from_slice(out.map.as_bytes()).expect("parse map");
    let js_lines: Vec<&str> = out.js.lines().collect();
    let arg_line = js_lines
        .iter()
        .position(|l| l.contains("const $a1 ="))
        .expect("arg temp line");
    let mut found = false;
    for token in map.tokens() {
        if token.get_dst_line() as usize == arg_line {
            assert_eq!(token.get_src_line(), 4, "tail call は lts 5行目(0始まりで4)に対応するはず");
            found = true;
        }
    }
    assert!(found, "ループ変換された引数評価行に source map マッピングが必要: {}", out.map);

    let mut_out = emit_fixture("tail-mutual").expect("emit tail-mutual");
    let mmap = sourcemap::SourceMap::from_slice(mut_out.map.as_bytes()).expect("parse map");
    let thunk_line = mut_out.js.lines().position(|l| l.contains("return $thunk(")).expect("thunk line");
    let mut found = false;
    for token in mmap.tokens() {
        if token.get_dst_line() as usize == thunk_line {
            found = true;
        }
    }
    assert!(found, "トランポリンの thunk 行に source map マッピングが必要");
}
