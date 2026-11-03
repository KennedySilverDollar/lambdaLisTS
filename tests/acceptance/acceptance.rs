use super::common::*;
use lists::check::{check_file, ModuleCache};
use lists::diagnostic::DiagKind;
use lists::emit::{emit, EmitInput};
use lists::eval::{global_env, load_file, Interp};
use lists::lexer::tokenize;
use lists::parser::parse_program;
use lists::value::{print_value, Value};
use std::collections::BTreeSet;

fn check_fixture(name: &str) -> lists::check::ModuleResult {
    let mut cache = ModuleCache::default();
    check_file(&fixture_path(name), &mut cache)
}

#[test]
fn t1_add_money_js_execution_value() {
    let dir = temp_dir("t1");
    compile_to_dir(&["money.lts"], &dir);
    std::fs::write(
        dir.join("driver.js"),
        "import { add_money } from \"./money.js\";\n\
         console.log(\"R1 \" + JSON.stringify(add_money({ amount: 1, currency: \"JPY\" }, { amount: 2, currency: \"JPY\" })));\n\
         console.log(\"R2 \" + JSON.stringify(add_money({ amount: 1, currency: \"JPY\" }, { amount: 2, currency: \"USD\" })));\n",
    )
    .expect("write driver");
    let r = run_node("driver.js", &dir, &[]);
    assert_eq!(r.status.code(), Some(0), "{}", String::from_utf8_lossy(&r.stderr));
    let stdout = String::from_utf8_lossy(&r.stdout);
    let r1 = stdout
        .lines()
        .find(|l| l.starts_with("R1 "))
        .map(|l| serde_json::from_str::<serde_json::Value>(&l[3..]).expect("json"))
        .expect("R1");
    let r2 = stdout
        .lines()
        .find(|l| l.starts_with("R2 "))
        .map(|l| serde_json::from_str::<serde_json::Value>(&l[3..]).expect("json"))
        .expect("R2");
    let ok_money = json_to_value(&serde_json::json!({"tag": "Ok", "value": {"amount": 3, "currency": "JPY"}}));
    assert!(values_equal(&json_to_value(&r1), &ok_money), "R1: {r1}");
    let err = json_to_value(&r2);
    assert!(
        matches!(&err, Value::Err(v) if matches!(v.as_ref(), Value::Str(s) if &**s == "currency mismatch: JPY vs USD")),
        "R2: {}",
        print_value(&err)
    );
}

#[test]
fn t2_stock_non_exhaustive_with_fix_golden() {
    let res = check_fixture("stock.lts");
    let d = res
        .diagnostics
        .iter()
        .find(|d| d.kind == DiagKind::NonExhaustive)
        .expect("non-exhaustive");
    assert_eq!(d.severity, lists::diagnostic::Severity::Error);
    let data = d.data.as_ref().expect("data");
    assert_eq!(data["missing"], serde_json::json!(["(obj (tag \"OutOfStock\"))"]));
    assert!(matches!(
        &d.fix,
        Some(lists::diagnostic::Patch::Insert { path, template })
            if path == "(defn show-error).body.arms"
                && template.contains("[(obj (tag \"OutOfStock\")) \"...\"]")
    ));
    assert_golden_json("t2.stock.diagnostics.json", normalize_diags(&res.diagnostics));
}

#[test]
fn t3_do_early_return_total_not_called() {
    let mut cache = ModuleCache::default();
    let r = check_file(&fixture_path("cart-spy.lts"), &mut cache);
    assert!(r.diagnostics.is_empty(), "{:?}", r.diagnostics);

    let env = global_env();
    let mut seen = BTreeSet::new();
    let defs = load_file(&fixture_path("cart-spy.lts"), &env, &mut seen).expect("load");
    let place_order = env.lookup("place-order").expect("place-order");
    let mut interp = Interp::new();
    let v = interp.apply(place_order, vec![Value::Array(vec![])]).expect("eval");
    assert!(matches!(v, Value::Err(_)), "{}", print_value(&v));
    assert!(
        !interp.calls().contains_key("total"),
        "total は呼ばれてはいけない: {:?}",
        interp.calls()
    );
    assert!(interp.calls().contains_key("check-items"));
    let _ = defs;

    let dir = temp_dir("t3");
    compile_to_dir(&["money.lts", "cart-spy.lts"], &dir);
    let r = run_node("cart-spy.js", &dir, &[]);
    assert_eq!(r.status.code(), Some(0), "{}", String::from_utf8_lossy(&r.stderr));
    let stdout = String::from_utf8_lossy(&r.stdout);
    assert!(stdout.contains("example 0: ok"), "{stdout}");
    assert!(stdout.contains("\"tag\":\"EmptyCart\""), "{stdout}");
    assert!(!stdout.contains("TOTAL-WAS-CALLED"), "{stdout}");
}

#[test]
fn t4_modules_import_and_cycle() {
    assert!(check_fixture("money.lts").diagnostics.is_empty());
    assert!(check_fixture("cart.lts").diagnostics.is_empty());
    let dir = temp_dir("t4");
    compile_to_dir(&["money.lts", "cart.lts"], &dir);
    let r = run_node("cart.js", &dir, &[]);
    assert_eq!(r.status.code(), Some(0), "{}", String::from_utf8_lossy(&r.stderr));
    let stdout = String::from_utf8_lossy(&r.stdout);
    assert!(stdout.contains("example 0: ok"), "{stdout}");
    assert!(stdout.contains("\"tag\":\"Err\""), "{stdout}");

    for name in ["cycle-a.lts", "cycle-b.lts"] {
        let res = check_fixture(name);
        assert!(
            res.diagnostics.iter().any(|d| d.kind == DiagKind::ModuleCycle),
            "{name}: {:?}",
            res.diagnostics
        );
    }
}

#[test]
fn t5_broken_lts_recovery() {
    let abs = fixture_path("broken.lts");
    let src = std::fs::read_to_string(&abs).expect("read");
    let lex = tokenize(&src, &abs);
    let (program, diags) = parse_program(&lex);
    assert_eq!(program.forms.len(), 2);
    let lists::ast::TopForm::Defn { name, body, .. } = &program.forms[0] else {
        panic!("forms[0] is not defn")
    };
    assert_eq!(&**name, "broken");
    assert!(matches!(body.as_ref(), lists::ast::Expr::Error { .. }));
    let lists::ast::TopForm::Defn { name, body, span, .. } = &program.forms[1] else {
        panic!("forms[1] is not defn")
    };
    assert_eq!(&**name, "ok");
    assert!(matches!(body.as_ref(), lists::ast::Expr::App { .. }));
    assert!(!diags.is_empty());
    assert!(diags.iter().all(|d| d.kind == DiagKind::ParseError));
    assert!(diags.iter().all(|d| d.span.end <= span.start));

    let (defs, _) = pipeline_file(&abs);
    let r = emit(&EmitInput {
        defs,
        file: "broken.js".to_string(),
        source_file: "broken.lts".to_string(),
        type_names: BTreeSet::new(),
    });
    let errs = r.expect_err("broken は emit エラーのはず");
    assert!(errs.iter().any(|d| d.kind == DiagKind::ParseError));
}

#[test]
fn t6_effect_violation_with_defn_bang_fix_golden() {
    let res = check_fixture("effects.lts");
    let d = res
        .diagnostics
        .iter()
        .find(|d| d.kind == DiagKind::EffectViolation)
        .expect("effect-violation");
    assert!(d.message.contains("log!"));
    assert!(matches!(
        &d.fix,
        Some(lists::diagnostic::Patch::Replace { path, template })
            if path == "(defn pure-run)" && template == "defn!"
    ));
    assert_golden_json("t6.effects.diagnostics.json", normalize_diags(&res.diagnostics));
}
