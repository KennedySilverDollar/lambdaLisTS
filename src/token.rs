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

#[derive(Debug, Clone, PartialEq)]
pub enum TokenKind {
    OpenParen,
    CloseParen,
    OpenBracket,
    CloseBracket,
    OpenBrace,
    CloseBrace,
    Punct(Rc<str>),
    Number(Rc<str>),
    Str(Rc<str>),
    Keyword(Rc<str>),
    Symbol(Rc<str>),
    DottedSymbol(Vec<Rc<str>>),
    Nil,
    Bool(bool),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Token {
    pub kind: TokenKind,
    pub trivia: Trivia,
    pub span: Span,
}
