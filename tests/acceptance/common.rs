use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::rc::Rc;

use lists::check::{check_file, ModuleCache};
use lists::desugar::{desugar, CoreDef};
use lists::diagnostic::Diagnostic;
use lists::emit::{emit, EmitInput};
use lists::eval::{global_env, run_examples, Interp};
use lists::lexer::tokenize;
use lists::parser::parse_program;
use lists::resolver::resolve_import_path;
use lists::runtime::RUNTIME_JS;
use lists::value::{structural_equal, Env, Value};
use serde_json::Value as Json;

pub fn fixture_path(name: &str) -> String {
    format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"))
}

pub fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("lists-m10-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("temp dir");
    dir
}

pub fn pipeline_file(abs: &str) -> (Vec<CoreDef>, Vec<Diagnostic>) {
    let src = std::fs::read_to_string(abs).expect("fixture readable");
    let lex = tokenize(&src, abs);
    let (program, mut diags) = parse_program(&lex);
    let (defs, ds_diags) = desugar(&program);
    diags.extend(ds_diags);
    (defs, diags)
}

pub fn compile_to_dir(names: &[&str], dir: &Path) {
    std::fs::write(dir.join("runtime.js"), RUNTIME_JS).expect("write runtime");
    for name in names {
        let abs = fixture_path(name);
        let (defs, diags) = pipeline_file(&abs);
        assert!(diags.is_empty(), "{name}: {diags:?}");
        let mut cache = ModuleCache::default();
        let checked = check_file(&abs, &mut cache);
        assert!(
            checked.diagnostics.is_empty(),
            "{name}: {:?}",
            checked.diagnostics
        );
        let type_names: BTreeSet<String> = checked.type_aliases.keys().map(|k| k.to_string()).collect();
        let base = name.trim_end_matches(".lts");
        let out = emit(&EmitInput {
            defs,
            file: format!("{base}.js"),
            source_file: name.to_string(),
            type_names,
        })
        .unwrap_or_else(|errs| panic!("emit errors for {name}: {errs:?}"));
        std::fs::write(dir.join(format!("{base}.js")), &out.js).expect("write js");
        std::fs::write(dir.join(format!("{base}.js.map")), &out.map).expect("write map");
    }
}

pub fn run_node(file: &str, cwd: &Path, args: &[&str]) -> Output {
    Command::new("node")
        .args(args)
        .arg(file)
        .current_dir(cwd)
        .output()
        .expect("node を起動できること (Node.js >= 20)")
}

pub fn node_example_values(dir: &Path, base: &str, count: usize) -> Vec<Json> {
    let r = run_node(&format!("{base}.js"), dir, &[]);
    assert_eq!(
        r.status.code(),
        Some(0),
        "node {base}.js failed: {}",
        String::from_utf8_lossy(&r.stderr)
    );
    let stdout = String::from_utf8_lossy(&r.stdout);
    let mut values = Vec::new();
    for line in stdout.lines() {
        if let Some(rest) = line.strip_prefix("example ") {
            if let Some((_idx, rest)) = rest.split_once(": ok ") {
                values.push(serde_json::from_str(rest).expect("example の JSON"));
            }
        }
    }
    if values.len() > count {
        values.drain(..values.len() - count);
    }
    values
}

pub fn interp_example_values(names: &[&str]) -> Vec<(bool, Value)> {
    let env: Rc<Env> = global_env();
    let mut seen: BTreeSet<String> = BTreeSet::new();
    let mut own_defs: Vec<CoreDef> = Vec::new();
    for name in names {
        let abs = fixture_path(name);
        let mut queue = vec![abs.clone()];
        let mut first = true;
        while let Some(path) = queue.pop() {
            if !seen.insert(path.clone()) {
                continue;
            }
            let (defs, diags) = pipeline_file(&path);
            assert!(diags.is_empty(), "{path}: {diags:?}");
            for d in &defs {
                if let CoreDef::Import { path: import_path, .. } = d {
                    if let Some(target) = resolve_import_path(&path, import_path) {
                        queue.push(target);
                    }
                }
            }
            lists::eval::load_defs(&defs, &env);
            if first {
                own_defs.extend(defs);
                first = false;
            }
        }
    }
    let mut interp = Interp::new();
    let results = run_examples(&mut interp, &own_defs, &env).expect("examples run");
    results.into_iter().map(|r| (r.pass, r.actual)).collect()
}

pub fn json_to_value(v: &Json) -> Value {
    match v {
        Json::Null => Value::Nil,
        Json::Bool(b) => Value::Bool(*b),
        Json::Number(n) => Value::Num(n.as_f64().expect("f64")),
        Json::String(s) => Value::Str(Rc::from(s.as_str())),
        Json::Array(a) => Value::Array(a.iter().map(json_to_value).collect()),
        Json::Object(m) => {
            if let (Some(tag), Some(val)) = (m.get("tag"), m.get("value")) {
                if tag == "Ok" {
                    return Value::Ok(Box::new(json_to_value(val)));
                }
                if tag == "Err" {
                    return Value::Err(Box::new(json_to_value(val)));
                }
            }
            Value::Obj(
                m.iter()
                    .map(|(k, v)| (Rc::from(k.as_str()), json_to_value(v)))
                    .collect::<BTreeMap<_, _>>(),
            )
        }
    }
}

pub fn normalize_diags(diags: &[Diagnostic]) -> Json {
    let v = serde_json::to_value(diags).expect("ser diags");
    strip_span_file(v)
}

fn strip_span_file(v: Json) -> Json {
    match v {
        Json::Object(m) => Json::Object(
            m.into_iter()
                .map(|(k, val)| {
                    if k == "span" {
                        if let Json::Object(mut sm) = val {
                            if let Some(Json::String(f)) = sm.get("file") {
                                let base = Path::new(f).file_name().map(|b| b.to_string_lossy().into_owned()).unwrap_or_else(|| f.clone());
                                sm.insert("file".to_string(), Json::String(base));
                            }
                            return (k, Json::Object(sm));
                        }
                    }
                    (k, strip_span_file(val))
                })
                .collect(),
        ),
        Json::Array(a) => Json::Array(a.into_iter().map(strip_span_file).collect()),
        other => other,
    }
}

pub fn assert_golden_json(label: &str, actual: Json) {
    let path = format!("{}/tests/golden/{label}", env!("CARGO_MANIFEST_DIR"));
    if std::env::var("UPDATE_SNAPSHOTS").is_ok() {
        let pretty = serde_json::to_string_pretty(&actual).expect("pretty");
        std::fs::write(&path, format!("{pretty}\n")).expect("write golden");
    }
    let content = std::fs::read_to_string(&path)
        .unwrap_or_else(|_| panic!("golden がありません: {path} (UPDATE_SNAPSHOTS=1 cargo test で生成)"));
    let expected: Json = serde_json::from_str(&content).expect("golden json");
    assert_eq!(actual, expected, "{path}");
}

pub fn values_equal(a: &Value, b: &Value) -> bool {
    structural_equal(a, b)
}
