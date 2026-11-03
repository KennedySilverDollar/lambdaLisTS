use crate::diagnostic::Diagnostic;
use crate::ir::Core;
use crate::value::{Env, Value};

#[derive(Debug, Clone, PartialEq)]
pub struct ExampleResult {
    pub name: String,
    pub pass: bool,
    pub actual: Option<Value>,
    pub expected: Option<Value>,
}

pub fn eval(_core: &Core, _env: &Env) -> Result<Value, Vec<Diagnostic>> {
    unimplemented!("eval: SPEC §8 — P0 未実装")
}

pub fn run_examples(_examples: &[(String, Core, Core)], _env: &Env) -> Vec<ExampleResult> {
    unimplemented!("eval: example実行 — P0 未実装")
}
