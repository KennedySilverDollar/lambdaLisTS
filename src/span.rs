use std::rc::Rc;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Span {
    pub file: Rc<str>,
    pub start: usize,
    pub end: usize,
    pub line: usize,
    pub col: usize,
}

pub fn span_of(_file: Rc<str>, _src: &str, _start: usize, _end: usize) -> Span {
    unimplemented!("span: P0 未実装")
}
