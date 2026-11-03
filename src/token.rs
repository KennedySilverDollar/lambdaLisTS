use std::rc::Rc;

use crate::span::Span;

#[derive(Debug, Clone, PartialEq)]
pub struct Comment {
    pub text: Rc<str>,
    pub span: Span,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct Trivia {
    pub leading: Vec<Comment>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenKind {
    OpenParen,
    CloseParen,
    OpenBracket,
    CloseBracket,
    OpenBrace,
    CloseBrace,
    Punct,
    Number,
    Str,
    Keyword,
    Symbol,
    DottedSymbol,
    Nil,
    Bool,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Punct {
    Colon,
    Plus,
    Minus,
    Star,
    Slash,
    Lt,
    Gt,
    Le,
    Ge,
    Eq,
    Arrow,
    FatArrow,
}

impl Punct {
    pub fn as_str(self) -> &'static str {
        match self {
            Punct::Colon => ":",
            Punct::Plus => "+",
            Punct::Minus => "-",
            Punct::Star => "*",
            Punct::Slash => "/",
            Punct::Lt => "<",
            Punct::Gt => ">",
            Punct::Le => "<=",
            Punct::Ge => ">=",
            Punct::Eq => "=",
            Punct::Arrow => "->",
            Punct::FatArrow => "=>",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub enum TokenValue {
    Punct(Punct),
    Num(f64),
    Str(String),
    Bool(bool),
    Keyword(Rc<str>),
    Symbol { name: Rc<str>, effect: bool },
    Dotted(Vec<Rc<str>>),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Token {
    pub kind: TokenKind,
    pub text: Rc<str>,
    pub value: Option<TokenValue>,
    pub trivia: Trivia,
    pub span: Span,
}
