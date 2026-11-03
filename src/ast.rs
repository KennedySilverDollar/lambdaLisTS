use std::rc::Rc;

use crate::ir::Pat;
use crate::span::Span;
use crate::token::Trivia;

#[derive(Debug, Clone, PartialEq)]
pub struct Program {
    pub forms: Vec<TopForm>,
    pub trailing: Trivia,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq)]
pub enum TopForm {
    Import(Import),
    Export(Export),
    TypeDef(TypeDef),
    EffectDef(EffectDef),
    Defn(Defn),
    Prop(Prop),
    Example(Example),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Import {
    pub path: Rc<str>,
    pub names: Vec<Rc<str>>,
    pub trivia: Trivia,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Export {
    pub names: Vec<Rc<str>>,
    pub trivia: Trivia,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TypeDef {
    pub name: Rc<str>,
    pub ty: TypeExpr,
    pub trivia: Trivia,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq)]
pub struct EffectDef {
    pub name: Rc<str>,
    pub ty: TypeExpr,
    pub trivia: Trivia,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Defn {
    pub effectful: bool,
    pub name: Rc<str>,
    pub params: Vec<ParamExpr>,
    pub ret: TypeExpr,
    pub body: Expr,
    pub trivia: Trivia,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Prop {
    pub name: Rc<str>,
    pub params: Vec<ParamExpr>,
    pub body: Expr,
    pub trivia: Trivia,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Example {
    pub lhs: Expr,
    pub rhs: Expr,
    pub trivia: Trivia,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ParamExpr {
    pub name: Rc<str>,
    pub ty: TypeExpr,
    pub span: Span,
}

#[derive(Debug, Clone, PartialEq)]
pub enum TypeExpr {
    Number,
    Str,
    Bool,
    Nil,
    Symbol(Rc<str>),
    Array(Box<TypeExpr>),
    Union(Vec<TypeExpr>),
    Obj(Vec<FieldExpr>),
    ResultT(Box<TypeExpr>, Box<TypeExpr>),
    Option(Box<TypeExpr>),
    FnT(Vec<TypeExpr>, Box<TypeExpr>),
}

#[derive(Debug, Clone, PartialEq)]
pub enum FieldExpr {
    Field { name: Rc<str>, ty: TypeExpr },
    Tag(Rc<str>),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Bind {
    pub name: Rc<str>,
    pub expr: Expr,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DoBindExpr {
    pub name: Rc<str>,
    pub expr: Expr,
}

#[derive(Debug, Clone, PartialEq)]
pub struct CondArm {
    pub cond: Expr,
    pub body: Expr,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Arm {
    pub pattern: Pat,
    pub body: Expr,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Expr {
    Number(Rc<str>, Span),
    Str(Rc<str>, Span),
    Bool(bool, Span),
    Nil(Span),
    Symbol(Rc<str>, Span),
    Dotted(Vec<Rc<str>>, Span),
    Call {
        head: Rc<str>,
        args: Vec<Expr>,
        trivia: Trivia,
        span: Span,
    },
    Let {
        binds: Vec<Bind>,
        body: Box<Expr>,
        trivia: Trivia,
        span: Span,
    },
    If {
        cond: Box<Expr>,
        then: Box<Expr>,
        else_: Box<Expr>,
        trivia: Trivia,
        span: Span,
    },
    When {
        cond: Box<Expr>,
        then: Box<Expr>,
        trivia: Trivia,
        span: Span,
    },
    Cond {
        arms: Vec<CondArm>,
        else_: Box<Expr>,
        trivia: Trivia,
        span: Span,
    },
    And {
        lhs: Box<Expr>,
        rhs: Box<Expr>,
        trivia: Trivia,
        span: Span,
    },
    Or {
        lhs: Box<Expr>,
        rhs: Box<Expr>,
        trivia: Trivia,
        span: Span,
    },
    Match {
        scrutinee: Box<Expr>,
        arms: Vec<Arm>,
        trivia: Trivia,
        span: Span,
    },
    Do {
        binds: Vec<DoBindExpr>,
        body: Box<Expr>,
        trivia: Trivia,
        span: Span,
    },
    Obj {
        fields: Vec<(Rc<str>, Expr)>,
        trivia: Trivia,
        span: Span,
    },
    Lam {
        params: Vec<ParamExpr>,
        ret: TypeExpr,
        body: Box<Expr>,
        trivia: Trivia,
        span: Span,
    },
    Pipe {
        first: Box<Expr>,
        rest: Vec<Expr>,
        trivia: Trivia,
        span: Span,
    },
}
