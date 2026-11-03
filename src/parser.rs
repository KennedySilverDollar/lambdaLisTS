use crate::ast::Program;
use crate::diagnostic::Diagnostic;
use crate::token::Token;

pub fn parse(_tokens: &[Token]) -> Result<Program, Vec<Diagnostic>> {
    unimplemented!("parser: SPEC §3 — P0 未実装")
}
