use std::collections::BTreeSet;
use std::path::Path;
use std::rc::Rc;

use serde_json::json;

use crate::diagnostic::{DiagKind, Diagnostic, Patch, Severity};
use crate::span::Span;

pub fn resolve_import_path(from_file: &str, import_path: &str) -> Option<String> {
    if !import_path.starts_with("./") && !import_path.starts_with("../") {
        return None;
    }
    let parent = Path::new(from_file).parent().unwrap_or(Path::new(""));
    let joined = parent.join(import_path);
    let abs = if joined.is_absolute() {
        joined
    } else {
        match std::env::current_dir() {
            Ok(cwd) => cwd.join(joined),
            Err(_) => joined,
        }
    };
    let mut normalized = std::path::PathBuf::new();
    for c in abs.components() {
        match c {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                normalized.pop();
            }
            other => normalized.push(other.as_os_str()),
        }
    }
    let s = normalized.to_string_lossy().into_owned();
    Some(if s.ends_with(".lts") {
        s
    } else {
        format!("{s}.lts")
    })
}

pub fn file_exists(path: &str) -> bool {
    Path::new(path).exists()
}

#[derive(Default)]
pub struct ModuleGraph {
    pub stack: Vec<String>,
}

impl ModuleGraph {
    pub fn is_on_stack(&self, path: &str) -> bool {
        self.stack.iter().any(|p| p == path)
    }

    pub fn enter(&mut self, path: &str) {
        self.stack.push(path.to_string());
    }

    pub fn leave(&mut self) {
        self.stack.pop();
    }
}

pub struct ModuleInfo {
    pub exports: Vec<String>,
    pub value_names: BTreeSet<String>,
    pub type_names: BTreeSet<String>,
    pub effect_names: BTreeSet<String>,
}

pub fn import_not_found(span: Span, import_path: &str, path: &str) -> Diagnostic {
    Diagnostic {
        kind: DiagKind::ImportNotFound,
        severity: Severity::Error,
        span,
        message: format!("import 先が見つかりません: '{import_path}'"),
        data: Some(json!({ "path": path, "import": import_path })),
        fix: None,
    }
}

pub fn module_cycle(span: Span, import_path: &str, path: &str) -> Diagnostic {
    Diagnostic {
        kind: DiagKind::ModuleCycle,
        severity: Severity::Error,
        span,
        message: format!("循環 import です: '{import_path}'"),
        data: Some(json!({ "path": path, "import": import_path })),
        fix: None,
    }
}

pub fn not_exported(span: Span, name: &str, import_path: &str, path: &str) -> Diagnostic {
    Diagnostic {
        kind: DiagKind::NotExported,
        severity: Severity::Error,
        span,
        message: format!("'{name}' は '{import_path}' で export されていません (§3.8)"),
        data: Some(json!({ "path": path, "name": name, "import": import_path })),
        fix: Some(Patch::Insert {
            path: path.to_string(),
            template: name.to_string(),
        }),
    }
}

pub fn check_import_names(
    mod_info: &ModuleInfo,
    names: &[Rc<str>],
    span: &Span,
    import_path: &str,
    path: &str,
) -> Vec<Diagnostic> {
    let mut diags = Vec::new();
    for name in names {
        if mod_info.type_names.contains(name.as_ref()) {
            continue;
        }
        if mod_info.value_names.contains(name.as_ref()) || mod_info.effect_names.contains(name.as_ref()) {
            if !mod_info.exports.iter().any(|e| e == name.as_ref()) {
                diags.push(not_exported(span.clone(), name, import_path, path));
            }
            continue;
        }
        diags.push(Diagnostic {
            kind: DiagKind::UnboundSymbol,
            severity: Severity::Error,
            span: span.clone(),
            message: format!("モジュール '{import_path}' に '{name}' が存在しません"),
            data: Some(json!({ "path": path, "name": name })),
            fix: None,
        });
    }
    diags
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::check::{check_file, ModuleCache};
    use crate::diagnostic::DiagKind;

    fn fixture_path(name: &str) -> String {
        format!("{}/tests/fixtures/{}", env!("CARGO_MANIFEST_DIR"), name)
    }

    #[test]
    fn resolve_import_path_relative_only() {
        assert_eq!(
            resolve_import_path("/a/b/c.lts", "./x.lts"),
            Some("/a/b/x.lts".to_string())
        );
        assert_eq!(
            resolve_import_path("/a/b/c.lts", "../y"),
            Some("/a/y.lts".to_string())
        );
        assert_eq!(resolve_import_path("/a/b/c.lts", "some-pkg"), None);
    }

    #[test]
    fn module_graph_stack_detects_cycles() {
        let mut g = ModuleGraph::default();
        g.enter("/a.lts");
        assert!(g.is_on_stack("/a.lts"));
        g.enter("/b.lts");
        assert!(g.is_on_stack("/a.lts"));
        assert!(!g.is_on_stack("/c.lts"));
        g.leave();
        assert!(!g.is_on_stack("/b.lts"));
        assert!(g.is_on_stack("/a.lts"));
    }

    #[test]
    fn check_import_names_namespaces() {
        let info = ModuleInfo {
            exports: vec!["pub".to_string()],
            value_names: BTreeSet::from(["pub".to_string(), "hidden".to_string()]),
            type_names: BTreeSet::from(["T".to_string()]),
            effect_names: BTreeSet::from(["log".to_string()]),
        };
        let span = Span {
            file: Rc::from("t.lts"),
            start: 0,
            end: 1,
            line: 1,
            col: 1,
        };
        assert!(check_import_names(&info, &[Rc::from("pub"), Rc::from("T")], &span, "./m.lts", "p").is_empty());
        let bad = check_import_names(
            &info,
            &[Rc::from("hidden"), Rc::from("log"), Rc::from("nope")],
            &span,
            "./m.lts",
            "p",
        );
        let kinds: Vec<DiagKind> = bad.iter().map(|d| d.kind.clone()).collect();
        assert_eq!(
            kinds,
            vec![
                DiagKind::NotExported,
                DiagKind::NotExported,
                DiagKind::UnboundSymbol
            ]
        );
    }

    #[test]
    fn cart_lts_imports_money_clean() {
        let mut cache = ModuleCache::default();
        let r = check_file(&fixture_path("cart.lts"), &mut cache);
        assert!(r.diagnostics.is_empty(), "{:?}", r.diagnostics);
    }

    #[test]
    fn mod_use_ok_exports_only_value() {
        let mut cache = ModuleCache::default();
        let r = check_file(&fixture_path("mod-use-ok.lts"), &mut cache);
        assert!(r.diagnostics.is_empty(), "{:?}", r.diagnostics);
    }

    #[test]
    fn mod_use_bad_not_exported() {
        let mut cache = ModuleCache::default();
        let r = check_file(&fixture_path("mod-use-bad.lts"), &mut cache);
        let d = r
            .diagnostics
            .iter()
            .find(|d| d.kind == DiagKind::NotExported)
            .expect("not-exported");
        assert!(d.message.contains("hidden"));
        assert_eq!(d.data.as_ref().expect("data")["name"], "hidden");
    }

    #[test]
    fn mod_use_type_imports_type_namespace() {
        let mut cache = ModuleCache::default();
        let r = check_file(&fixture_path("mod-use-type.lts"), &mut cache);
        assert!(r.diagnostics.is_empty(), "{:?}", r.diagnostics);
    }

    #[test]
    fn mod_missing_is_import_not_found() {
        let mut cache = ModuleCache::default();
        let r = check_file(&fixture_path("mod-missing.lts"), &mut cache);
        assert!(r
            .diagnostics
            .iter()
            .any(|d| d.kind == DiagKind::ImportNotFound));
    }

    #[test]
    fn cycle_a_b_report_module_cycle() {
        for name in ["cycle-a.lts", "cycle-b.lts"] {
            let mut cache = ModuleCache::default();
            let r = check_file(&fixture_path(name), &mut cache);
            assert!(
                r.diagnostics
                    .iter()
                    .any(|d| d.kind == DiagKind::ModuleCycle),
                "{name}: {:?}",
                r.diagnostics
            );
        }
    }
}
