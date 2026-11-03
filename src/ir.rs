use std::rc::Rc;

use crate::span::Span;
use crate::types::Type;
use crate::value::Value;

#[derive(Debug, Clone, PartialEq)]
pub enum Core {
    Lit { value: Value, span: Span },
    Var { name: Rc<str>, span: Span },
    Lam { params: Vec<Param>, ret: Type, body: Box<Core>, pure: bool, span: Span },
    App { f: Box<Core>, args: Vec<Core>, span: Span },
    Let { name: Rc<str>, rhs: Box<Core>, body: Box<Core>, span: Span },
    If { cond: Box<Core>, then: Box<Core>, else_: Box<Core>, span: Span },
    Match { scrutinee: Box<Core>, arms: Vec<MatchArm>, span: Span },
    Obj { fields: Vec<(Rc<str>, Core)>, span: Span },
    Field { obj: Box<Core>, name: Rc<str>, span: Span },
    EffectCall { effect: Rc<str>, args: Vec<Core>, span: Span },
    Do { binds: Vec<DoBind>, body: Box<Core>, span: Span },
    Error { message: String, span: Span },
}

#[derive(Debug, Clone, PartialEq)]
pub struct Param {
    pub name: Rc<str>,
    pub ty: Type,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DoBind {
    pub name: Rc<str>,
    pub expr: Core,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MatchArm {
    pub pattern: Pat,
    pub body: Core,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Pat {
    pub kind: PatKind,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq)]
pub enum PatKind {
    Wildcard,
    Var(Rc<str>),
    Lit(Value),
    Obj(Vec<(Rc<str>, Pat)>),
    Array(Vec<Pat>),
    Or(Vec<Pat>),
}
