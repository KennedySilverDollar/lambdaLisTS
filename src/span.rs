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

pub fn span_of(file: Rc<str>, src: &str, start: usize, end: usize) -> Span {
    let mut line: usize = 1;
    let mut line_start: usize = 0;
    for (i, ch) in src.char_indices() {
        if i >= start {
            break;
        }
        if ch == '\n' {
            line += 1;
            line_start = i + ch.len_utf8();
        }
    }
    let col = src[line_start..start].chars().count() + 1;
    Span {
        file,
        start,
        end,
        line,
        col,
    }
}
