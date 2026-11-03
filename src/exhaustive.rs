use crate::diagnostic::Diagnostic;
use crate::ir::Pat;
use crate::types::Type;

pub fn check_exhaustive(_scrutinee: &Type, _arms: &[Pat]) -> Result<(), Vec<Diagnostic>> {
    unimplemented!("exhaustive: SPEC §6.5 — P0 未実装")
}
