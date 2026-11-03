use std::collections::BTreeMap;

use crate::diagnostic::Diagnostic;
use crate::types::Type;

pub type Subst = BTreeMap<usize, Type>;

pub fn unify(_expected: &Type, _actual: &Type, _subst: &mut Subst) -> Result<(), Vec<Diagnostic>> {
    unimplemented!("unify: SPEC §6.4 rank-1 — P0 未実装")
}
