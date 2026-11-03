use crate::ast::Program;
use crate::diagnostic::Diagnostic;

pub fn format_source(_src: &str) -> Result<String, Vec<Diagnostic>> {
    unimplemented!("fmt: SPEC §10.3 — P0 未実装")
}

pub fn format_program(_program: &Program) -> String {
    unimplemented!("fmt: SPEC §10.3 — P0 未実装")
}
