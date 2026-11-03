use serde::{Deserialize, Serialize};

use crate::span::Span;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DiagKind {
    ParseError,
    TypeMismatch,
    UnboundSymbol,
    NonExhaustive,
    RedundantArm,
    EffectViolation,
    UnknownEffect,
    ArityMismatch,
    NameConvention,
    DuplicateDefinition,
    TypeSyntaxError,
    ImportNotFound,
    NotExported,
    ModuleCycle,
    InternalError,
    UnsupportedInP0,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Severity {
    #[serde(rename = "error")]
    Error,
    #[serde(rename = "warning")]
    Warning,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Diagnostic {
    pub kind: DiagKind,
    pub severity: Severity,
    pub span: Span,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fix: Option<Patch>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "op")]
pub enum Patch {
    #[serde(rename = "replace")]
    Replace { path: String, template: String },
    #[serde(rename = "insert")]
    Insert { path: String, template: String },
    #[serde(rename = "delete")]
    Delete { path: String },
}

pub type AstPath = String;

#[derive(Debug, thiserror::Error)]
#[error("internal-error: {0}")]
pub struct InternalError(pub String);

pub fn to_json_line(_diags: &[Diagnostic]) -> String {
    unimplemented!("diagnostic: P0 未実装")
}

pub fn ast_path<S: AsRef<str>>(base: &str, segments: &[S]) -> AstPath {
    if segments.is_empty() {
        base.to_string()
    } else {
        let segs: Vec<&str> = segments.iter().map(|s| s.as_ref()).collect();
        format!("{}.{}", base, segs.join("."))
    }
}

pub fn top_form_path(form: &crate::ast::TopForm, index: usize) -> AstPath {
    use crate::ast::TopForm;
    match form {
        TopForm::Defn { name, .. } => format!("(defn {name})"),
        TopForm::TypeDef { name, .. } => format!("(type {name})"),
        TopForm::EffectDef { name, .. } => format!("(effect {name})"),
        TopForm::Prop { .. } => format!("(prop {index})"),
        TopForm::Example { .. } => format!("(example {index})"),
        TopForm::Import { .. } => "(import)".to_string(),
        TopForm::Export { .. } => "(export)".to_string(),
        TopForm::Error { .. } => "(error)".to_string(),
    }
}
