use crate::diagnostic::Diagnostic;
use crate::ir::Core;
use crate::types::{Scheme, Type};

#[derive(Debug, Default)]
pub struct CheckCtx {
    pub globals: Vec<(String, Scheme)>,
}

pub fn infer(_ctx: &CheckCtx, _core: &Core) -> Result<Type, Vec<Diagnostic>> {
    unimplemented!("check: SPEC §6.3 infer — P0 未実装")
}

pub fn check(_ctx: &CheckCtx, _core: &Core, _expected: &Type) -> Result<(), Vec<Diagnostic>> {
    unimplemented!("check: SPEC §6.3 check — P0 未実装")
}
