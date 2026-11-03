use std::rc::Rc;

use serde_json::json;

use crate::desugar::CoreDef;
use crate::diagnostic::{DiagKind, Diagnostic, Patch, Severity};
use crate::ir::Core;
use crate::span::Span;

#[derive(Debug, Clone, PartialEq)]
pub struct EffectCallSite {
    pub effect: Rc<str>,
    pub span: Span,
}

pub fn find_effect_calls(e: &Core, out: &mut Vec<EffectCallSite>) {
    match e {
        Core::EffectCall {
            effect, args, span, ..
        } => {
            out.push(EffectCallSite {
                effect: effect.clone(),
                span: span.clone(),
            });
            for a in args {
                find_effect_calls(a, out);
            }
        }
        Core::Lam { body, .. } => find_effect_calls(body, out),
        Core::App { f, args, .. } => {
            find_effect_calls(f, out);
            for a in args {
                find_effect_calls(a, out);
            }
        }
        Core::Let { rhs, body, .. } => {
            find_effect_calls(rhs, out);
            find_effect_calls(body, out);
        }
        Core::If {
            cond,
            then,
            else_,
            ..
        } => {
            find_effect_calls(cond, out);
            find_effect_calls(then, out);
            find_effect_calls(else_, out);
        }
        Core::Match {
            scrutinee, arms, ..
        } => {
            find_effect_calls(scrutinee, out);
            for a in arms {
                find_effect_calls(&a.body, out);
            }
        }
        Core::Obj { fields, .. } => {
            for (_, c) in fields {
                find_effect_calls(c, out);
            }
        }
        Core::Field { obj, .. } => find_effect_calls(obj, out),
        Core::Do { binds, body, .. } => {
            for b in binds {
                find_effect_calls(&b.expr, out);
            }
            find_effect_calls(body, out);
        }
        _ => {}
    }
}

pub fn check_effects(defs: &[CoreDef]) -> Vec<Diagnostic> {
    let mut diags = Vec::new();
    for d in defs {
        let CoreDef::Defn {
            name,
            body,
            pure,
            path,
            ..
        } = d
        else {
            continue;
        };
        if !pure {
            continue;
        }
        let mut sites = Vec::new();
        find_effect_calls(body, &mut sites);
        for site in sites {
            diags.push(Diagnostic {
                kind: DiagKind::EffectViolation,
                severity: Severity::Error,
                span: site.span,
                message: format!(
                    "純粋関数 '{name}' >本体でエフェクト '{effect}!' を呼んでいます（defn! が必要です §7.4）",
                    effect = site.effect
                ),
                data: Some(json!({ "path": path, "effect": site.effect })),
                fix: Some(Patch::Replace {
                    path: path.clone(),
                    template: "defn!".to_string(),
                }),
            });
        }
    }
    diags
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::check::{check_file, check_source, ModuleCache};
    use crate::desugar::desugar;
    use crate::lexer::tokenize;
    use crate::parser::parse_program;

    fn defs_of(src: &str) -> Vec<CoreDef> {
        let lex = tokenize(src, "test.lts");
        let (program, _) = parse_program(&lex);
        desugar(&program).0
    }

    fn check_src(src: &str) -> crate::check::ModuleResult {
        let mut cache = ModuleCache::default();
        check_source(src, "test.lts", &mut cache)
    }

    fn fixture_path(name: &str) -> String {
        format!("{}/tests/fixtures/{}", env!("CARGO_MANIFEST_DIR"), name)
    }

    #[test]
    fn effects_lts_pure_run_log_is_violation_with_defn_bang_fix() {
        let mut cache = ModuleCache::default();
        let r = check_file(&fixture_path("effects.lts"), &mut cache);
        let d = r
            .diagnostics
            .iter()
            .find(|d| d.kind == DiagKind::EffectViolation)
            .expect("effect-violation");
        assert_eq!(d.severity, Severity::Error);
        assert!(d.message.contains("log!"));
        let data = d.data.as_ref().expect("data");
        assert_eq!(data["path"], "(defn pure-run)");
        assert_eq!(data["effect"], "log");
        assert!(matches!(&d.fix, Some(Patch::Replace { path, template })
            if path == "(defn pure-run)" && template == "defn!"));
    }

    #[test]
    fn defn_bang_body_effect_call_is_not_violation() {
        let r = check_src("(effect log : (fn (s : string) : nil))\n(defn! f (s : string) : nil (log! s))");
        assert!(
            !r.diagnostics
                .iter()
                .any(|d| d.kind == DiagKind::EffectViolation),
            "{:?}",
            r.diagnostics
        );
        assert!(r.diagnostics.is_empty(), "{:?}", r.diagnostics);
    }

    #[test]
    fn undeclared_effect_call_is_unknown_effect() {
        let r = check_src("(effect log : (fn (s : string) : nil))\n(defn! f () : nil (db! \"x\"))");
        let d = r
            .diagnostics
            .iter()
            .find(|d| d.kind == DiagKind::UnknownEffect)
            .expect("unknown-effect");
        assert!(d.message.contains("db!"));
    }

    #[test]
    fn effect_call_args_checked_against_declaration() {
        let r = check_src("(effect log : (fn (s : string) : nil))\n(defn! f () : nil (log! 1))");
        assert!(r
            .diagnostics
            .iter()
            .any(|d| d.kind == DiagKind::TypeMismatch));
    }

    #[test]
    fn find_effect_calls_sees_nested_forms() {
        let defs = defs_of(
            "(defn f (x : number) : number (if (< x 0) (log! \"a\") (let [y (db! \"k\")] (+ x 1))))",
        );
        let CoreDef::Defn { body, .. } = &defs[0] else {
            panic!("not defn")
        };
        let mut sites = Vec::new();
        find_effect_calls(body, &mut sites);
        let mut names: Vec<&str> = sites.iter().map(|s| &*s.effect).collect();
        names.sort_unstable();
        assert_eq!(names, ["db", "log"]);
        let diags = check_effects(&defs);
        assert_eq!(diags.len(), 2);
        assert!(diags.iter().all(|d| d.kind == DiagKind::EffectViolation));
    }

    #[test]
    fn pure_defn_without_effect_calls_has_no_violation() {
        let r = check_src("(defn f (x : number) : number (+ x 1))");
        assert!(r.diagnostics.is_empty(), "{:?}", r.diagnostics);
    }
}
