use std::collections::BTreeMap;
use std::rc::Rc;

use serde::{Deserialize, Serialize};

use crate::ir::{Core, Param};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
    Builtin(Rc<Builtin>),
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Closure {
    pub params: Vec<Param>,
    pub body: Rc<Core>,
    pub env: Rc<Env>,
    pub name: Option<Rc<str>>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BuiltinKind {
    Add,
    Sub,
    Mul,
    Div,
    Lt,
    Gt,
    Le,
    Ge,
    Eq,
    Mod,
    Abs,
    Min,
    Max,
    Not,
    Str,
    StrConcat,
    StrSlice,
    Len,
    Contains,
    Split,
    Array,
    Nth,
    Count,
    Slice,
    Push,
    Concat,
    Map,
    Filter,
    FoldLeft,
    Find,
    Any,
    All,
    Ok,
    Err,
    Bind,
    MapResult,
    Traverse,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Builtin {
    pub name: Rc<str>,
    pub kind: BuiltinKind,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct Env {
    vars: std::cell::RefCell<BTreeMap<Rc<str>, Value>>,
    parent: Option<Rc<Env>>,
}

impl Env {
    pub fn new() -> Rc<Env> {
        Rc::new(Env {
            vars: std::cell::RefCell::new(BTreeMap::new()),
            parent: None,
        })
    }

    pub fn child_of(parent: &Rc<Env>, vars: BTreeMap<Rc<str>, Value>) -> Rc<Env> {
        Rc::new(Env {
            vars: std::cell::RefCell::new(vars),
            parent: Some(parent.clone()),
        })
    }

    pub fn define(&self, name: Rc<str>, value: Value) {
        self.vars.borrow_mut().insert(name, value);
    }

    pub fn lookup(&self, name: &str) -> Option<Value> {
        let mut cur = Some(self);
        while let Some(e) = cur {
            if let Some(v) = e.vars.borrow().get(name) {
                return Some(v.clone());
            }
            cur = e.parent.as_deref();
        }
        None
    }
}

pub fn structural_equal(a: &Value, b: &Value) -> bool {
    match (a, b) {
        (Value::Num(x), Value::Num(y)) => x == y,
        (Value::Str(x), Value::Str(y)) => x == y,
        (Value::Bool(x), Value::Bool(y)) => x == y,
        (Value::Nil, Value::Nil) => true,
        (Value::Array(xs), Value::Array(ys)) => {
            xs.len() == ys.len()
                && xs
                    .iter()
                    .zip(ys.iter())
                    .all(|(x, y)| structural_equal(x, y))
        }
        (Value::Obj(x), Value::Obj(y)) => {
            x.len() == y.len()
                && x
                    .iter()
                    .all(|(k, v)| y.get(k).is_some_and(|yv| structural_equal(v, yv)))
        }
        (Value::Ok(x), Value::Ok(y)) => structural_equal(x, y),
        (Value::Err(x), Value::Err(y)) => structural_equal(x, y),
        (Value::Closure(x), Value::Closure(y)) => Rc::ptr_eq(x, y),
        (Value::Builtin(x), Value::Builtin(y)) => Rc::ptr_eq(x, y),
        _ => false,
    }
}

pub fn print_value(v: &Value) -> String {
    match v {
        Value::Nil => "nil".to_string(),
        Value::Str(s) => s.to_string(),
        Value::Num(n) => {
            if n.is_nan() {
                "NaN".to_string()
            } else if n.is_infinite() {
                if *n > 0.0 {
                    "Infinity".to_string()
                } else {
                    "-Infinity".to_string()
                }
            } else {
                format!("{n}")
            }
        }
        Value::Bool(b) => format!("{b}"),
        Value::Array(xs) => format!(
            "[{}]",
            xs.iter().map(print_value).collect::<Vec<_>>().join(" ")
        ),
        Value::Ok(x) => format!("(ok {})", print_value(x)),
        Value::Err(x) => format!("(err {})", print_value(x)),
        Value::Obj(fields) => format!(
            "{{{}}}",
            fields
                .iter()
                .map(|(k, v)| format!("{k}: {}", print_value(v)))
                .collect::<Vec<_>>()
                .join(", ")
        ),
        Value::Closure(_) | Value::Builtin(_) => "<fn>".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn obj(pairs: Vec<(&str, Value)>) -> Value {
        Value::Obj(pairs.into_iter().map(|(k, v)| (Rc::from(k), v)).collect())
    }

    #[test]
    fn structural_equal_prims_and_nan() {
        assert!(structural_equal(&Value::Num(1.0), &Value::Num(1.0)));
        assert!(!structural_equal(&Value::Num(f64::NAN), &Value::Num(f64::NAN)));
        assert!(structural_equal(&Value::Str(Rc::from("a")), &Value::Str(Rc::from("a"))));
        assert!(!structural_equal(&Value::Bool(true), &Value::Bool(false)));
        assert!(structural_equal(&Value::Nil, &Value::Nil));
        assert!(!structural_equal(&Value::Num(1.0), &Value::Str(Rc::from("1"))));
    }

    #[test]
    fn structural_equal_arrays_recursive() {
        let a = Value::Array(vec![Value::Num(1.0), Value::Array(vec![Value::Num(2.0), Value::Num(3.0)])]);
        let b = Value::Array(vec![Value::Num(1.0), Value::Array(vec![Value::Num(2.0), Value::Num(3.0)])]);
        let c = Value::Array(vec![Value::Num(1.0), Value::Array(vec![Value::Num(2.0), Value::Num(4.0)])]);
        let d = Value::Array(vec![Value::Num(1.0), Value::Num(2.0), Value::Num(3.0)]);
        assert!(structural_equal(&a, &b));
        assert!(!structural_equal(&a, &c));
        assert!(!structural_equal(&a, &d));
    }

    #[test]
    fn structural_equal_obj_key_order_independent() {
        let a = obj(vec![("a", Value::Num(1.0)), ("b", obj(vec![("c", Value::Num(2.0))]))]);
        let b = obj(vec![("b", obj(vec![("c", Value::Num(2.0))])), ("a", Value::Num(1.0))]);
        assert!(structural_equal(&a, &b));
        assert!(!structural_equal(&a, &obj(vec![("a", Value::Num(1.0))])));
        assert!(!structural_equal(&a, &obj(vec![("a", Value::Num(2.0)), ("b", obj(vec![("c", Value::Num(2.0))]))])));
    }

    #[test]
    fn structural_equal_result_tag_and_value() {
        assert!(structural_equal(
            &Value::Ok(Box::new(Value::Num(1.0))),
            &Value::Ok(Box::new(Value::Num(1.0)))
        ));
        assert!(!structural_equal(
            &Value::Ok(Box::new(Value::Num(1.0))),
            &Value::Err(Box::new(Value::Num(1.0)))
        ));
        assert!(structural_equal(
            &Value::Err(Box::new(obj(vec![("tag", Value::Str(Rc::from("EmptyCart")))]))),
            &Value::Err(Box::new(obj(vec![("tag", Value::Str(Rc::from("EmptyCart")))])))
        ));
        assert!(!structural_equal(
            &obj(vec![("tag", Value::Str(Rc::from("EmptyCart")))]),
            &Value::Ok(Box::new(Value::Nil))
        ));
    }
    #[test]
    fn structural_equal_edge_cases_against_appendix_c() {
        // 空obj
        assert!(structural_equal(&obj(vec![]), &obj(vec![])));
        assert!(!structural_equal(&obj(vec![]), &obj(vec![("a", Value::Num(1.0))])));
        // 深いネスト（配列/obj混在）
        let deep = |v: f64| {
            obj(vec![
                ("arr", Value::Array(vec![Value::Num(v), obj(vec![("x", Value::Array(vec![Value::Bool(true)]))])])),
                ("n", Value::Num(v)),
            ])
        };
        assert!(structural_equal(&deep(1.0), &deep(1.0)));
        assert!(!structural_equal(&deep(1.0), &deep(2.0)));
        // 数値比較: NaN は NaN と等しくない（§8.3）。-0 と +0 は等しい（IEEE754 の == と同じ）
        assert!(!structural_equal(&Value::Num(f64::NAN), &Value::Num(f64::NAN)));
        assert!(structural_equal(&Value::Num(-0.0), &Value::Num(0.0)));
        assert!(structural_equal(&Value::Num(1.0), &Value::Num(1.0)));
        assert!(!structural_equal(&Value::Num(1.0), &Value::Num(2.0)));
        // Result: tag と value の両方（ネスト含む）
        assert!(structural_equal(
            &Value::Ok(Box::new(Value::Array(vec![Value::Num(1.0)]))),
            &Value::Ok(Box::new(Value::Array(vec![Value::Num(1.0)])))
        ));
        assert!(!structural_equal(
            &Value::Ok(Box::new(Value::Num(1.0))),
            &Value::Err(Box::new(Value::Num(1.0)))
        ));
        // 型が違えば false（Num vs Str、Array vs Obj）
        assert!(!structural_equal(&Value::Array(vec![]), &obj(vec![])));
        assert!(!structural_equal(&Value::Nil, &Value::Num(0.0)));
    }

}
