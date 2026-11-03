use std::collections::BTreeMap;
use std::rc::Rc;

use crate::ir::{Core, Param};

#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Num(f64),
    Str(Rc<str>),
    Bool(bool),
    Nil,
    Array(Vec<Value>),
    Obj(BTreeMap<Rc<str>, Value>),
    Ok(Box<Value>),
    Err(Box<Value>),
    Closure(Rc<Closure>),
}

#[derive(Debug, Clone, PartialEq)]
pub struct Closure {
    pub params: Vec<Param>,
    pub body: Rc<Core>,
    pub env: Env,
}

pub type Env = BTreeMap<Rc<str>, Value>;

pub fn structural_equal(_a: &Value, _b: &Value) -> bool {
    unimplemented!("value: SPEC §8.3 structural_equal — P0 未実装")
}
