use serde_json::Value;

use crate::value::Env;

#[derive(Debug, Default)]
pub struct ReplState {
    pub env: Env,
}

pub fn handle_line(_line: &str, _state: &mut ReplState) -> Value {
    unimplemented!("repl: SPEC §10.1 JSON Lines — P0 未実装")
}

pub fn run() {
    unimplemented!("repl: SPEC §10.1 — P0 未実装")
}
