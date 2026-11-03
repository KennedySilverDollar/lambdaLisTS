use std::collections::BTreeMap;
use std::rc::Rc;

use crate::types::{Scheme, Type};

fn v(id: usize) -> Type {
    Type::Var(id)
}

fn fn_t(params: Vec<Type>, ret: Type) -> Type {
    Type::FnT(params, Box::new(ret))
}

fn arr(el: Type) -> Type {
    Type::Array(Box::new(el))
}

fn res(ok: Type, err: Type) -> Type {
    Type::ResultT(Box::new(ok), Box::new(err))
}

fn opt(t: Type, nil_t: &Type) -> Type {
    Type::Union(vec![t, nil_t.clone()])
}

fn entry(name: &str, vars: Vec<usize>, body: Type) -> (Rc<str>, Scheme) {
    (Rc::from(name), Scheme { vars, body })
}

pub fn stdlib() -> BTreeMap<Rc<str>, Scheme> {
    let num = Type::Number;
    let str_t = Type::Str;
    let bool_t = Type::Bool;
    let nil_t = Type::Nil;
    BTreeMap::from([
        entry("+", vec![], fn_t(vec![num.clone(), num.clone()], num.clone())),
        entry("-", vec![], fn_t(vec![num.clone(), num.clone()], num.clone())),
        entry("*", vec![], fn_t(vec![num.clone(), num.clone()], num.clone())),
        entry("/", vec![], fn_t(vec![num.clone(), num.clone()], num.clone())),
        entry("<", vec![], fn_t(vec![num.clone(), num.clone()], bool_t.clone())),
        entry(">", vec![], fn_t(vec![num.clone(), num.clone()], bool_t.clone())),
        entry("<=", vec![], fn_t(vec![num.clone(), num.clone()], bool_t.clone())),
        entry(">=", vec![], fn_t(vec![num.clone(), num.clone()], bool_t.clone())),
        entry("=", vec![1], fn_t(vec![v(1), v(1)], bool_t.clone())),
        entry("mod", vec![], fn_t(vec![num.clone(), num.clone()], num.clone())),
        entry("abs", vec![], fn_t(vec![num.clone()], num.clone())),
        entry("min", vec![], fn_t(vec![num.clone(), num.clone()], num.clone())),
        entry("max", vec![], fn_t(vec![num.clone(), num.clone()], num.clone())),
        entry("not", vec![], fn_t(vec![bool_t.clone()], bool_t.clone())),
        entry("str", vec![1], fn_t(vec![v(1)], str_t.clone())),
        entry("str-concat", vec![], fn_t(vec![str_t.clone(), str_t.clone()], str_t.clone())),
        entry("str-slice", vec![], fn_t(vec![str_t.clone(), num.clone(), num.clone()], str_t.clone())),
        entry("len", vec![], fn_t(vec![str_t.clone()], num.clone())),
        entry("contains?", vec![], fn_t(vec![str_t.clone(), str_t.clone()], bool_t.clone())),
        entry("split", vec![], fn_t(vec![str_t.clone(), str_t.clone()], arr(str_t.clone()))),
        entry("array", vec![1], fn_t(vec![v(1), v(1)], arr(v(1)))),
        entry("nth", vec![1], fn_t(vec![arr(v(1)), num.clone()], opt(v(1), &nil_t))),
        entry("count", vec![1], fn_t(vec![arr(v(1))], num.clone())),
        entry("slice", vec![1], fn_t(vec![arr(v(1)), num.clone(), num.clone()], arr(v(1)))),
        entry("push", vec![1], fn_t(vec![arr(v(1)), v(1)], arr(v(1)))),
        entry("concat", vec![1], fn_t(vec![arr(v(1)), arr(v(1))], arr(v(1)))),
        entry(
            "map",
            vec![1, 2],
            fn_t(vec![arr(v(1)), fn_t(vec![v(1)], v(2))], arr(v(2))),
        ),
        entry(
            "filter",
            vec![1],
            fn_t(vec![arr(v(1)), fn_t(vec![v(1)], bool_t.clone())], arr(v(1))),
        ),
        entry(
            "fold-left",
            vec![1, 2],
            fn_t(
                vec![arr(v(1)), v(2), fn_t(vec![v(2), v(1)], v(2))],
                v(2),
            ),
        ),
        entry(
            "find",
            vec![1],
            fn_t(vec![arr(v(1)), fn_t(vec![v(1)], bool_t.clone())], opt(v(1), &nil_t)),
        ),
        entry(
            "any?",
            vec![1],
            fn_t(vec![arr(v(1)), fn_t(vec![v(1)], bool_t.clone())], bool_t.clone()),
        ),
        entry(
            "all?",
            vec![1],
            fn_t(vec![arr(v(1)), fn_t(vec![v(1)], bool_t.clone())], bool_t.clone()),
        ),
        entry("ok", vec![1, 2], fn_t(vec![v(1)], res(v(1), v(2)))),
        entry("err", vec![1, 2], fn_t(vec![v(2)], res(v(1), v(2)))),
        entry(
            "bind",
            vec![1, 2, 3],
            fn_t(
                vec![res(v(1), v(2)), fn_t(vec![v(1)], res(v(3), v(2)))],
                res(v(3), v(2)),
            ),
        ),
        entry(
            "map-result",
            vec![1, 2, 3],
            fn_t(vec![res(v(1), v(2)), fn_t(vec![v(1)], v(3))], res(v(3), v(2))),
        ),
        entry(
            "traverse",
            vec![1, 2, 3],
            fn_t(
                vec![arr(v(1)), fn_t(vec![v(1)], res(v(3), v(2)))],
                res(arr(v(3)), v(2)),
            ),
        ),
    ])
}
