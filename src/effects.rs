use std::rc::Rc;

use crate::diagnostic::Diagnostic;
use crate::ir::Core;

pub fn check_effects(_core: &Core, _allowed: &[Rc<str>]) -> Result<(), Vec<Diagnostic>> {
    unimplemented!("effects: SPEC §7.4 — P0 未実装")
}
