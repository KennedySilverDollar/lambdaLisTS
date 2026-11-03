use crate::ast::{Expr, Program, TopForm};
use crate::diagnostic::Diagnostic;
use crate::ir::Core;

pub fn desugar_program(_program: &Program) -> Result<Vec<(String, Core)>, Vec<Diagnostic>> {
    unimplemented!("desugar: SPEC §4 — P0 未実装")
}

pub fn desugar_top_form(_form: &TopForm) -> Result<Option<(String, Core)>, Vec<Diagnostic>> {
    unimplemented!("desugar: SPEC §4 — P0 未実装")
}

pub fn desugar_expr(_expr: &Expr) -> Result<Core, Vec<Diagnostic>> {
    unimplemented!("desugar: SPEC §4 — P0 未実装")
}
