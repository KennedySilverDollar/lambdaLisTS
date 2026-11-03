use std::rc::Rc;

use crate::diagnostic::Diagnostic;
use crate::token::Token;

pub fn tokenize(_src: &str, _file: Rc<str>) -> Result<Vec<Token>, Vec<Diagnostic>> {
    unimplemented!("lexer: SPEC §2 — P0 未実装")
}
