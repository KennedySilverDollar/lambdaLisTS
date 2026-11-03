use crate::ir::Core;

#[derive(Debug, Clone, Default)]
pub struct EmitOutput {
    pub js: String,
    pub map: Option<String>,
}

pub fn lower(_core: &Core) -> String {
    unimplemented!("emit: SPEC §12.4 lowering — P0 未実装")
}

pub fn emit_module(_module_name: &str, _defs: &[(String, Core)]) -> EmitOutput {
    unimplemented!("emit: SPEC §12 — P0 未実装")
}
