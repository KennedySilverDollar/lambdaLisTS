use std::collections::BTreeMap;
use std::rc::Rc;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Type {
    Number,
    Str,
    Bool,
    Nil,
    Literal(Rc<str>),
    Array(Box<Type>),
    Union(Vec<Type>),
    Obj(BTreeMap<Rc<str>, Type>),
    ResultT(Box<Type>, Box<Type>),
    FnT(Vec<Type>, Box<Type>),
    Var(usize),
    Alias(Rc<str>),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Scheme {
    pub vars: Vec<usize>,
    pub body: Type,
}

pub fn normalize(_t: &Type) -> Type {
    unimplemented!("types: SPEC §6.2 normalize — P0 未実装")
}

pub fn display(_t: &Type) -> String {
    unimplemented!("types: SPEC §6.2 正規表示 — P0 未実装")
}

pub fn instantiate(_scheme: &Scheme) -> Type {
    unimplemented!("types: P0 未実装")
}
