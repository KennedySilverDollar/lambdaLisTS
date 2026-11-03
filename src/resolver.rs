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
    let s = abs.to_string_lossy().into_owned();
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
