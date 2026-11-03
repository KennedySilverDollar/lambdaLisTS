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
