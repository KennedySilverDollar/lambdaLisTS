use std::collections::BTreeMap;
use std::rc::Rc;

use serde::{Deserialize, Serialize};

use crate::ir::{Core, Param};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum Value {
    Num(f64),
    Dec(i128),
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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
    ToDec,
    ToNum,
    /// モック host のハンドラ（host.rs）。呼び出しを log に記録し、default を返す。
    /// log は実行時の記録なのでシリアライズしない。
    HostMock {
        effect: Rc<str>,
        default: Value,
        #[serde(skip)]
        log: Rc<std::cell::RefCell<Vec<crate::host::HostCall>>>,
    },
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

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum EqualError {
    #[error("循環構造上の `=` は実行時エラーです（SPEC §8.3/§8.6）: 比較経路上で同一の値対を再訪しました")]
    Cyclic,
}

// 循環は JS 表現（参照共有）でのみ発生しうるため、所有ベースの木構造である Rust の Value では
// この循環検出は発火しない（SPEC §8.3「循環構造における構造的等価」）。
pub fn structural_equal(a: &Value, b: &Value) -> Result<bool, EqualError> {
    let mut path: Vec<(usize, usize)> = Vec::new();
    eq_visit(a, b, &mut path)
}

fn node_id(v: &Value) -> usize {
    v as *const Value as usize
}

fn eq_visit(a: &Value, b: &Value, path: &mut Vec<(usize, usize)>) -> Result<bool, EqualError> {
    match (a, b) {
        (Value::Num(x), Value::Num(y)) => Ok(x == y),
        (Value::Str(x), Value::Str(y)) => Ok(x == y),
        (Value::Bool(x), Value::Bool(y)) => Ok(x == y),
        (Value::Nil, Value::Nil) => Ok(true),
        (Value::Array(xs), Value::Array(ys)) => {
            if xs.len() != ys.len() {
                return Ok(false);
            }
            let pair = (node_id(a), node_id(b));
            if path.contains(&pair) {
                return Err(EqualError::Cyclic);
            }
            path.push(pair);
            let mut ok = true;
            for (x, y) in xs.iter().zip(ys.iter()) {
                if !eq_visit(x, y, path)? {
                    ok = false;
                    break;
                }
            }
            path.pop();
            Ok(ok)
        }
        (Value::Obj(x), Value::Obj(y)) => {
            if x.len() != y.len() {
                return Ok(false);
            }
            let pair = (node_id(a), node_id(b));
            if path.contains(&pair) {
                return Err(EqualError::Cyclic);
            }
            path.push(pair);
            let mut ok = true;
            for (k, v) in x.iter() {
                match y.get(k) {
                    Some(yv) => {
                        if !eq_visit(v, yv, path)? {
                            ok = false;
                            break;
                        }
                    }
                    None => {
                        ok = false;
                        break;
                    }
                }
            }
            path.pop();
            Ok(ok)
        }
        (Value::Ok(x), Value::Ok(y)) => eq_boxed(x, y, a, b, path),
        (Value::Err(x), Value::Err(y)) => eq_boxed(x, y, a, b, path),
        (Value::Dec(x), Value::Dec(y)) => Ok(x == y),
        (Value::Closure(x), Value::Closure(y)) => Ok(Rc::ptr_eq(x, y)),
        (Value::Builtin(x), Value::Builtin(y)) => Ok(Rc::ptr_eq(x, y)),
        _ => Ok(false),
    }
}

fn eq_boxed(
    x: &Value,
    y: &Value,
    a: &Value,
    b: &Value,
    path: &mut Vec<(usize, usize)>,
) -> Result<bool, EqualError> {
    let pair = (node_id(a), node_id(b));
    if path.contains(&pair) {
        return Err(EqualError::Cyclic);
    }
    path.push(pair);
    let r = eq_visit(x, y, path);
    path.pop();
    r
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
        Value::Dec(s) => crate::decimal::fmt_dec(*s),
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

    fn eq(a: &Value, b: &Value) -> bool {
        structural_equal(a, b).expect("structural_equal")
    }

    fn obj(pairs: Vec<(&str, Value)>) -> Value {
        Value::Obj(pairs.into_iter().map(|(k, v)| (Rc::from(k), v)).collect())
    }

    #[test]
    fn structural_equal_prims_and_nan() {
        assert!(eq(&Value::Num(1.0), &Value::Num(1.0)));
        assert!(!eq(&Value::Num(f64::NAN), &Value::Num(f64::NAN)));
        assert!(eq(&Value::Str(Rc::from("a")), &Value::Str(Rc::from("a"))));
        assert!(!eq(&Value::Bool(true), &Value::Bool(false)));
        assert!(eq(&Value::Nil, &Value::Nil));
        assert!(!eq(&Value::Num(1.0), &Value::Str(Rc::from("1"))));
    }

    #[test]
    fn structural_equal_arrays_recursive() {
        let a = Value::Array(vec![Value::Num(1.0), Value::Array(vec![Value::Num(2.0), Value::Num(3.0)])]);
        let b = Value::Array(vec![Value::Num(1.0), Value::Array(vec![Value::Num(2.0), Value::Num(3.0)])]);
        let c = Value::Array(vec![Value::Num(1.0), Value::Array(vec![Value::Num(2.0), Value::Num(4.0)])]);
        let d = Value::Array(vec![Value::Num(1.0), Value::Num(2.0), Value::Num(3.0)]);
        assert!(eq(&a, &b));
        assert!(!eq(&a, &c));
        assert!(!eq(&a, &d));
    }

    #[test]
    fn structural_equal_obj_key_order_independent() {
        let a = obj(vec![("a", Value::Num(1.0)), ("b", obj(vec![("c", Value::Num(2.0))]))]);
        let b = obj(vec![("b", obj(vec![("c", Value::Num(2.0))])), ("a", Value::Num(1.0))]);
        assert!(eq(&a, &b));
        assert!(!eq(&a, &obj(vec![("a", Value::Num(1.0))])));
        assert!(!eq(&a, &obj(vec![("a", Value::Num(2.0)), ("b", obj(vec![("c", Value::Num(2.0))]))])));
    }

    #[test]
    fn structural_equal_result_tag_and_value() {
        assert!(eq(
            &Value::Ok(Box::new(Value::Num(1.0))),
            &Value::Ok(Box::new(Value::Num(1.0)))
        ));
        assert!(!eq(
            &Value::Ok(Box::new(Value::Num(1.0))),
            &Value::Err(Box::new(Value::Num(1.0)))
        ));
        assert!(eq(
            &Value::Err(Box::new(obj(vec![("tag", Value::Str(Rc::from("EmptyCart")))]))),
            &Value::Err(Box::new(obj(vec![("tag", Value::Str(Rc::from("EmptyCart")))])))
        ));
        assert!(!eq(
            &obj(vec![("tag", Value::Str(Rc::from("EmptyCart")))]),
            &Value::Ok(Box::new(Value::Nil))
        ));
    }
    #[test]
    fn structural_equal_edge_cases_against_appendix_c() {
        // 空obj
        assert!(eq(&obj(vec![]), &obj(vec![])));
        assert!(!eq(&obj(vec![]), &obj(vec![("a", Value::Num(1.0))])));
        // 深いネスト（配列/obj混在）
        let deep = |v: f64| {
            obj(vec![
                ("arr", Value::Array(vec![Value::Num(v), obj(vec![("x", Value::Array(vec![Value::Bool(true)]))])])),
                ("n", Value::Num(v)),
            ])
        };
        assert!(eq(&deep(1.0), &deep(1.0)));
        assert!(!eq(&deep(1.0), &deep(2.0)));
        // 数値比較: NaN は NaN と等しくない（§8.3）。-0 と +0 は等しい（IEEE754 の == と同じ）
        assert!(!eq(&Value::Num(f64::NAN), &Value::Num(f64::NAN)));
        assert!(eq(&Value::Num(-0.0), &Value::Num(0.0)));
        assert!(eq(&Value::Num(1.0), &Value::Num(1.0)));
        assert!(!eq(&Value::Num(1.0), &Value::Num(2.0)));
        // Result: tag と value の両方（ネスト含む）
        assert!(eq(
            &Value::Ok(Box::new(Value::Array(vec![Value::Num(1.0)]))),
            &Value::Ok(Box::new(Value::Array(vec![Value::Num(1.0)])))
        ));
        assert!(!eq(
            &Value::Ok(Box::new(Value::Num(1.0))),
            &Value::Err(Box::new(Value::Num(1.0)))
        ));
        // 型が違えば false（Num vs Str、Array vs Obj）
        assert!(!eq(&Value::Array(vec![]), &obj(vec![])));
        assert!(!eq(&Value::Nil, &Value::Num(0.0)));
    }

    #[test]
    fn structural_equal_detects_cycle_on_path_revisit() {
        let a = Value::Array(vec![Value::Num(1.0)]);
        let b = Value::Array(vec![Value::Num(1.0)]);
        let mut path = vec![(node_id(&a), node_id(&b))];
        assert_eq!(eq_visit(&a, &b, &mut path), Err(EqualError::Cyclic));
        let mut path = Vec::new();
        assert_eq!(eq_visit(&a, &b, &mut path), Ok(true));
    }

    #[test]
    fn structural_equal_same_reference_is_true_not_cycle() {
        let a = Value::Array(vec![Value::Num(1.0), Value::Array(vec![Value::Bool(true)])]);
        assert_eq!(structural_equal(&a, &a), Ok(true));
        let o = obj(vec![("x", Value::Ok(Box::new(Value::Num(2.0))))]);
        assert_eq!(structural_equal(&o, &o), Ok(true));
    }

    #[test]
    fn print_value_number_conventions_are_normative() {
        assert_eq!(print_value(&Value::Num(1.0)), "1");
        assert_eq!(print_value(&Value::Num(-0.0)), "-0");
        assert_eq!(print_value(&Value::Num(f64::NAN)), "NaN");
        assert_eq!(print_value(&Value::Num(f64::INFINITY)), "Infinity");
        assert_eq!(print_value(&Value::Num(f64::NEG_INFINITY)), "-Infinity");
        assert_eq!(print_value(&Value::Num(0.1)), "0.1");
        assert_eq!(print_value(&Value::Num(1e21)), "1000000000000000000000");
        assert_eq!(print_value(&Value::Num(1e-7)), "0.0000001");
        assert_eq!(print_value(&Value::Num(1.5e-10)), "0.00000000015");
    }

    #[test]
    fn print_value_containers_and_results() {
        assert_eq!(print_value(&Value::Nil), "nil");
        assert_eq!(print_value(&Value::Bool(true)), "true");
        assert_eq!(print_value(&Value::Str(Rc::from("hi"))), "hi");
        assert_eq!(
            print_value(&Value::Array(vec![Value::Num(1.0), Value::Array(vec![Value::Num(2.0)])])),
            "[1 [2]]"
        );
        assert_eq!(
            print_value(&obj(vec![("b", Value::Num(2.0)), ("a", Value::Num(1.0))])),
            "{a: 1, b: 2}"
        );
        assert_eq!(print_value(&Value::Ok(Box::new(Value::Num(1.0)))), "(ok 1)");
        assert_eq!(print_value(&Value::Err(Box::new(Value::Str(Rc::from("x"))))), "(err x)");
    }

}
