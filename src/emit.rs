use std::collections::{BTreeMap, BTreeSet};

use serde_json::json;

use crate::desugar::CoreDef;
use crate::diagnostic::{DiagKind, Diagnostic, Severity};
use crate::effects::{find_defn_calls, find_effect_calls};
use crate::ir::Core;
use crate::sourcemap_out::MapBuilder;
use crate::span::Span;
use crate::stdlib::stdlib;
use crate::types::Type;
use crate::value::Value;

const JS_RESERVED: &[&str] = &[
    "await", "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete",
    "do", "else", "enum", "export", "extends", "false", "finally", "for", "function", "if",
    "implements", "import", "in", "instanceof", "interface", "let", "new", "null", "package",
    "private", "protected", "public", "return", "static", "super", "switch", "this", "throw",
    "true", "try", "typeof", "undefined", "var", "void", "while", "with", "yield",
];

const RUNTIME_EXPORTS: &[&str] = &["ok", "err", "structuralEqual"];

// SPEC §11.6/付録C #11: slice/str-slice の境界規則（slice_bounds）の生成コード側実装。
const SLICE_BOUNDS_JS: &str = "function $slice_bounds(len, start, end) {\n  const s = Number.isNaN(start) ? 0 : start < 0 ? Math.max(len + start, 0) : Math.min(start, len);\n  const e = Number.isNaN(end) ? len : end < 0 ? Math.max(len + end, 0) : Math.min(end, len);\n  return [Math.trunc(s), Math.trunc(Math.max(e, s))];\n}\n";

// SPEC §11.6/付録C #10: str の印字規約（print_value 互換）。f64 は指数表記を展開する。
const PRINT_JS: &str = "function $print(v) {\n  if (v === null) return \"nil\";\n  if (typeof v === \"string\") return v;\n  if (typeof v === \"number\") return $print_num(v);\n  if (typeof v === \"boolean\") return v ? \"true\" : \"false\";\n  if (Array.isArray(v)) return \"[\" + v.map($print).join(\" \") + \"]\";\n  if (typeof v === \"object\") {\n    if (v.tag === \"Ok\" && Object.keys(v).length === 2 && \"value\" in v) return \"(ok \" + $print(v.value) + \")\";\n    if (v.tag === \"Err\" && Object.keys(v).length === 2 && \"value\" in v) return \"(err \" + $print(v.value) + \")\";\n    const ks = Object.keys(v).sort($cmp_str);\n    return \"{\" + ks.map((k) => k + \": \" + $print(v[k])).join(\", \") + \"}\";\n  }\n  return \"<fn>\";\n}\nfunction $print_num(n) {\n  if (Number.isNaN(n)) return \"NaN\";\n  if (n === Infinity) return \"Infinity\";\n  if (n === -Infinity) return \"-Infinity\";\n  if (Object.is(n, -0)) return \"-0\";\n  const s = String(n);\n  if (s.indexOf(\"e\") < 0 && s.indexOf(\"E\") < 0) return s;\n  const m = /^(-?)(\\d+)(?:\\.(\\d+))?[eE]([+-]?\\d+)$/.exec(s);\n  if (!m) return s;\n  const sign = m[1];\n  const digits = m[2] + (m[3] || \"\");\n  const point = m[2].length + parseInt(m[4], 10);\n  if (point <= 0) return sign + \"0.\" + \"0\".repeat(-point) + digits;\n  if (point >= digits.length) return sign + digits + \"0\".repeat(point - digits.length);\n  return sign + digits.slice(0, point) + \".\" + digits.slice(point);\n}\nfunction $cmp_str(a, b) {\n  const pa = [...a];\n  const pb = [...b];\n  const n = Math.min(pa.length, pb.length);\n  for (let i = 0; i < n; i++) {\n    const d = pa[i].codePointAt(0) - pb[i].codePointAt(0);\n    if (d !== 0) return d;\n  }\n  return pa.length - pb.length;\n}\n";

// decimal（M23）用のローカルヘルパ。BigInt のスケール済み整数で interp(i128) とビット一致する。
// エラーメッセージは interp 側（src/decimal.rs の ERR_*）と同一文字列。
const DEC_JS: &str = "const $DEC_S = 10n ** 18n;\nconst $DEC_MAX = 170141183460469231731687303715884105727n;\nfunction $dec_check(r) { if (r > $DEC_MAX || r < -$DEC_MAX) throw new Error(\"decimal-overflow\"); return r; }\nconst $dec_add = (a, b) => $dec_check(a + b);\nconst $dec_sub = (a, b) => $dec_check(a - b);\nconst $dec_mul = (a, b) => { const p = a * b; const neg = p < 0n; const ap = neg ? -p : p; let q = ap / $DEC_S; const r = ap % $DEC_S; if (2n * r >= $DEC_S) q += 1n; return $dec_check(neg ? -q : q); };\nconst $dec_div = (a, b) => { if (b === 0n) throw new Error(\"decimal-division-by-zero\"); const neg = (a < 0n) !== (b < 0n); const num = (a < 0n ? -a : a) * $DEC_S; const den = b < 0n ? -b : b; let q = num / den; const r = num % den; if (2n * r >= den) q += 1n; return $dec_check(neg ? -q : q); };\nfunction $print_dec(v) { const neg = v < 0n; const a = neg ? -v : v; const i = a / $DEC_S; const f = a % $DEC_S; return (neg ? \"-\" : \"\") + i.toString() + \".\" + f.toString().padStart(18, \"0\"); }\nconst $to_dec = (a) => { if (typeof a !== \"number\" || Number.isNaN(a) || !Number.isFinite(a)) throw new Error(\"decimal-overflow\"); const m = /^([+-]?)(\\d+)(?:\\.(\\d+))?e([+-]?\\d+)$/.exec(a.toExponential()); if (!m) throw new Error(\"decimal-overflow\"); const sign = m[1] === \"-\" ? -1n : 1n; const digits = m[2] + (m[3] || \"\"); const exp = parseInt(m[4], 10) - (m[3] || \"\").length + 18; const mant = BigInt(digits); let r; if (exp >= 0) { r = mant * 10n ** BigInt(exp); } else { const den = 10n ** BigInt(-exp); let q = mant / den; const rem = mant % den; if (2n * rem >= den) q += 1n; r = q; } return $dec_check(sign * r); };\nfunction $json(v) { if (typeof v === \"bigint\") return JSON.stringify({ tag: \"Dec\", value: $print_dec(v) }); if (Array.isArray(v)) return \"[\" + v.map($json).join(\",\") + \"]\"; if (v !== null && typeof v === \"object\") { const ks = Object.keys(v).sort(); return \"{\" + ks.map((k) => JSON.stringify(k) + \":\" + $json(v[k])).join(\",\") + \"}\"; } return JSON.stringify(v); }\n";

pub fn js_name(name: &str) -> String {
    let mut n = name.replace('-', "_");
    if n.ends_with('?') {
        n = format!("{}_q", &n[..n.len() - 1]);
    }
    if JS_RESERVED.contains(&n.as_str()) {
        n = format!("${n}");
    }
    n
}

fn stdlib_alias(name: &str) -> Option<&'static str> {
    Some(match name {
        "+" => "add",
        "-" => "sub",
        "*" => "mul",
        "/" => "div",
        "<" => "lt",
        ">" => "gt",
        "<=" => "le",
        ">=" => "ge",
        "=" => "eq",
        _ => return None,
    })
}

pub fn stdlib_js_name(name: &str) -> String {
    match stdlib_alias(name) {
        Some(a) => format!("$stdlib_{a}"),
        None => format!("$stdlib_{}", js_name(name)),
    }
}

pub fn lit_js(value: &Value) -> String {
    match value {
        Value::Nil => "null".to_string(),
        Value::Str(s) => serde_json::to_string(s.as_ref()).unwrap_or_else(|_| format!("\"{s}\"")),
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
        Value::Dec(s) => format!("{s}n"),
        _ => "null".to_string(),
    }
}

pub struct EmitInput {
    pub defs: Vec<CoreDef>,
    pub file: String,
    pub source_file: String,
    pub type_names: BTreeSet<String>,
    /// import 先も含む「defn! の名前」集合（async 生成の要否判定用。ローカルの defn! は pure フラグから自動で足す）。
    pub impure_names: BTreeSet<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct EmitOutput {
    pub js: String,
    pub map: String,
}

fn contains_error_node(e: &Core) -> bool {
    match e {
        Core::Error { .. } => true,
        Core::Lam { body, .. } => contains_error_node(body),
        Core::App { f, args, .. } => {
            contains_error_node(f) || args.iter().any(contains_error_node)
        }
        Core::Let { rhs, body, .. } => contains_error_node(rhs) || contains_error_node(body),
        Core::If {
            cond,
            then,
            else_,
            ..
        } => {
            contains_error_node(cond) || contains_error_node(then) || contains_error_node(else_)
        }
        Core::Match {
            scrutinee, arms, ..
        } => contains_error_node(scrutinee) || arms.iter().any(|a| contains_error_node(&a.body)),
        Core::Obj { fields, .. } => fields.iter().any(|(_, c)| contains_error_node(c)),
        Core::Field { obj, .. } => contains_error_node(obj),
        Core::Do { binds, body, .. } => {
            binds.iter().any(|b| contains_error_node(&b.expr)) || contains_error_node(body)
        }
        _ => false,
    }
}

/// エフェクト名を host オブジェクトのプロパティアクセスにする（§12.3/§12.4）。
/// host のフィールドは obj リテラルと同じく js_name で出力するので、ここも js_name に揃える。
fn effect_prop(name: &str) -> String {
    format!(".{}", js_name(name))
}

fn core_has_effect_call(e: &Core) -> bool {
    let mut sites = Vec::new();
    find_effect_calls(e, &mut sites);
    !sites.is_empty()
}

fn core_calls_impure(e: &Core, impure: &BTreeSet<String>) -> bool {
    let mut calls = Vec::new();
    find_defn_calls(e, &mut calls);
    calls.iter().any(|c| impure.contains(c.callee.as_ref()))
}

/// P1: defn!（またはエフェクト呼び出しを含む式）があるモジュールは async 生成を行う。
fn defs_use_async(defs: &[CoreDef], impure: &BTreeSet<String>) -> bool {
    for d in defs {
        match d {
            CoreDef::Defn { pure, body, .. } => {
                if !pure || core_has_effect_call(body) || core_calls_impure(body, impure) {
                    return true;
                }
            }
            CoreDef::Example {
                actual, expected, ..
            } => {
                if core_has_effect_call(actual) || core_has_effect_call(expected) {
                    return true;
                }
            }
            CoreDef::Prop { body, .. } => {
                if core_has_effect_call(body) {
                    return true;
                }
            }
            _ => {}
        }
    }
    false
}

fn core_uses_decimal(e: &Core) -> bool {
    match e {
        Core::Lit { value: Value::Dec(_), .. } => true,
        Core::Var { name, .. } => matches!(name.as_ref(), "to-dec" | "to-num"),
        Core::App { f, args, .. } => {
            core_uses_decimal(f)
                || args.iter().any(core_uses_decimal)
        }
        Core::Lam { body, .. } => core_uses_decimal(body),
        Core::Let { rhs, body, .. } => core_uses_decimal(rhs) || core_uses_decimal(body),
        Core::If { cond, then, else_, .. } => {
            core_uses_decimal(cond) || core_uses_decimal(then) || core_uses_decimal(else_)
        }
        Core::Match { scrutinee, arms, .. } => {
            core_uses_decimal(scrutinee) || arms.iter().any(|a| core_uses_decimal(&a.body))
        }
        Core::Obj { fields, .. } => fields.iter().any(|(_, c)| core_uses_decimal(c)),
        Core::Field { obj, .. } => core_uses_decimal(obj),
        Core::EffectCall { args, .. } => args.iter().any(core_uses_decimal),
        Core::Do { binds, body, .. } => {
            binds.iter().any(|b| core_uses_decimal(&b.expr)) || core_uses_decimal(body)
        }
        _ => false,
    }
}

fn type_is_dec(t: &Type) -> bool {
    matches!(t, Type::Dec)
}

fn defs_use_decimal(defs: &[CoreDef]) -> bool {
    defs.iter().any(|d| match d {
        CoreDef::Defn {
            body,
            params,
            ret,
            ..
        } => {
            core_uses_decimal(body)
                || params.iter().any(|p| type_is_dec(&p.ty))
                || type_is_dec(ret)
        }
        CoreDef::Example {
            actual, expected, ..
        } => core_uses_decimal(actual) || core_uses_decimal(expected),
        CoreDef::Prop { body, params, .. } => {
            core_uses_decimal(body) || params.iter().any(|p| type_is_dec(&p.ty))
        }
        _ => false,
    })
}

pub fn emit(input: &EmitInput) -> Result<EmitOutput, Vec<Diagnostic>> {
    let mut errors: Vec<Diagnostic> = Vec::new();
    for d in &input.defs {
        match d {
            CoreDef::Error {
                message,
                span,
                path,
            } => errors.push(Diagnostic {
                kind: DiagKind::ParseError,
                severity: Severity::Error,
                span: span.clone(),
                message: message.clone(),
                data: Some(json!({ "path": path })),
                fix: None,
            }),
            CoreDef::Defn {
                name,
                body,
                span,
                path,
                ..
            } => {
                if contains_error_node(body) {
                    errors.push(Diagnostic {
                        kind: DiagKind::ParseError,
                        severity: Severity::Error,
                        span: span.clone(),
                        message: format!("フォーム '{name}' にパースエラーの回復ノードが含まれます"),
                        data: Some(json!({ "path": path })),
                        fix: None,
                    });
                }
            }
            _ => {}
        }
    }
    if !errors.is_empty() {
        return Err(errors);
    }

    let mut forms: Vec<&CoreDef> = input.defs.iter().collect();
    forms.sort_by_key(|d| d.span().start);

    let mut probe = Gen::new(input);
    {
        let mut sink = JsWriter::sink();
        for d in &forms {
            probe.form_js(d, &mut sink);
        }
    }
    let header = probe.header();

    let mut w = JsWriter::new(&input.file, &input.source_file);
    if !header.is_empty() {
        w.write(&header);
    }
    let mut gen = Gen::new(input);
    if gen.uses_trampoline() {
        w.line("const $TAIL = Symbol(\"lists.tail\");");
        w.line("const $thunk = (f, args) => ({ [$TAIL]: true, f, args });");
        if gen.uses_async {
            w.line("async function $run(v) { while (v !== null && typeof v === \"object\" && v[$TAIL] === true) { v = await v.f(...v.args); } return v; }");
        } else {
            w.line("function $run(v) { while (v !== null && typeof v === \"object\" && v[$TAIL] === true) { v = v.f(...v.args); } return v; }");
        }
        w.line("");
    }
    for d in &forms {
        gen.form_js(d, &mut w);
    }
    let (body, map_builder) = w.into_parts();
    let map = map_builder.to_json();
    let js = format!("{body}\n//# sourceMappingURL={}.map\n", input.file);
    Ok(EmitOutput { js, map })
}

struct JsWriter {
    buf: String,
    line: u32,
    col: u32,
    map: Option<MapBuilder>,
}

impl JsWriter {
    fn new(out_file: &str, source_file: &str) -> Self {
        JsWriter {
            buf: String::new(),
            line: 0,
            col: 0,
            map: Some(MapBuilder::new(out_file, source_file)),
        }
    }

    fn sink() -> Self {
        JsWriter {
            buf: String::new(),
            line: 0,
            col: 0,
            map: None,
        }
    }

    fn write(&mut self, s: &str) {
        for ch in s.chars() {
            if ch == '\n' {
                self.line += 1;
                self.col = 0;
            } else {
                self.col += 1;
            }
        }
        self.buf.push_str(s);
    }

    fn line(&mut self, s: &str) {
        self.write(s);
        self.write("\n");
    }

    fn map_at(&mut self, span: &Span, name: Option<&str>) {
        if let Some(m) = &mut self.map {
            m.add(self.line, self.col, span, name);
        }
    }

    fn into_parts(self) -> (String, MapBuilder) {
        let map = self.map.unwrap_or_else(|| MapBuilder::new("", ""));
        (self.buf, map)
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum TailKind {
    Normal,
    SelfLoop,
    Trampoline,
}

#[derive(Clone)]
enum TailCtx {
    SelfLoop { fn_js: String, params: Vec<String> },
    Trampoline { members: BTreeSet<String> },
}

enum TailCallee {
    Defn(String),
    Indirect,
}

// Core IR 上の末尾位置（SPEC §8.5）にある App の呼び出し先を集める。
fn collect_tail_callees(
    e: &Core,
    in_tail: bool,
    defn_names: &BTreeSet<String>,
    import_names: &BTreeSet<String>,
    out: &mut Vec<TailCallee>,
) {
    match e {
        Core::App { f, args, .. } => {
            if in_tail {
                match f.as_ref() {
                    Core::Var { name, .. } => {
                        if defn_names.contains(name.as_ref()) {
                            out.push(TailCallee::Defn(name.to_string()));
                        } else if !RUNTIME_EXPORTS.contains(&name.as_ref())
                            && !stdlib().contains_key(name.as_ref())
                            && !import_names.contains(name.as_ref())
                        {
                            out.push(TailCallee::Indirect);
                        }
                    }
                    _ => out.push(TailCallee::Indirect),
                }
            }
            collect_tail_callees(f, false, defn_names, import_names, out);
            for a in args {
                collect_tail_callees(a, false, defn_names, import_names, out);
            }
        }
        // ラムダは独立した関数として Normal に出力するので、ここでは回収しない
        Core::Lam { .. } => {}
        Core::Let { rhs, body, .. } => {
            collect_tail_callees(rhs, false, defn_names, import_names, out);
            collect_tail_callees(body, in_tail, defn_names, import_names, out);
        }
        Core::If {
            cond,
            then,
            else_,
            ..
        } => {
            collect_tail_callees(cond, false, defn_names, import_names, out);
            collect_tail_callees(then, in_tail, defn_names, import_names, out);
            collect_tail_callees(else_, in_tail, defn_names, import_names, out);
        }
        Core::Match { scrutinee, arms, .. } => {
            collect_tail_callees(scrutinee, false, defn_names, import_names, out);
            for arm in arms {
                collect_tail_callees(&arm.body, in_tail, defn_names, import_names, out);
            }
        }
        Core::Obj { fields, .. } => {
            for (_, c) in fields {
                collect_tail_callees(c, false, defn_names, import_names, out);
            }
        }
        Core::Field { obj, .. } => collect_tail_callees(obj, false, defn_names, import_names, out),
        Core::Do { binds, body, .. } => {
            for b in binds {
                collect_tail_callees(&b.expr, false, defn_names, import_names, out);
            }
            collect_tail_callees(body, in_tail, defn_names, import_names, out);
        }
        _ => {}
    }
}

fn reachable(start: &str, graph: &BTreeMap<String, BTreeSet<String>>) -> BTreeSet<String> {
    let mut seen = BTreeSet::new();
    let mut stack = vec![start.to_string()];
    while let Some(n) = stack.pop() {
        if !seen.insert(n.clone()) {
            continue;
        }
        if let Some(nexts) = graph.get(&n) {
            for m in nexts {
                stack.push(m.clone());
            }
        }
    }
    seen
}

struct TailAnalysis {
    kinds: BTreeMap<String, TailKind>,
    scc_members: BTreeMap<String, BTreeSet<String>>,
}

fn analyze_tail(defs: &[CoreDef]) -> TailAnalysis {
    let defn_names: BTreeSet<String> = defs
        .iter()
        .filter_map(|d| match d {
            CoreDef::Defn { name, .. } => Some(name.to_string()),
            _ => None,
        })
        .collect();
    let import_names: BTreeSet<String> = defs
        .iter()
        .filter_map(|d| match d {
            CoreDef::Import { names, .. } => Some(names.iter().map(|n| n.to_string()).collect::<Vec<_>>()),
            _ => None,
        })
        .flatten()
        .collect();
    let mut graph: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    let mut callees: BTreeMap<String, Vec<TailCallee>> = BTreeMap::new();
    for d in defs {
        if let CoreDef::Defn { name, body, .. } = d {
            let mut out = Vec::new();
            collect_tail_callees(body, true, &defn_names, &import_names, &mut out);
            let edges: BTreeSet<String> = out
                .iter()
                .filter_map(|c| match c {
                    TailCallee::Defn(n) => Some(n.clone()),
                    TailCallee::Indirect => None,
                })
                .collect();
            graph.insert(name.to_string(), edges);
            callees.insert(name.to_string(), out);
        }
    }
    let mut kinds = BTreeMap::new();
    let mut scc_members = BTreeMap::new();
    for name in defn_names.iter() {
        let out = &callees[name];
        let edges = &graph[name];
        let has_indirect = out.iter().any(|c| matches!(c, TailCallee::Indirect));
        let self_edge = edges.contains(name);
        let reach_from = reachable(name, &graph);
        let members: BTreeSet<String> = graph
            .keys()
            .filter(|m| reach_from.contains(*m) && reachable(m, &graph).contains(name))
            .cloned()
            .collect();
        let kind = if edges.is_empty() && !has_indirect {
            TailKind::Normal
        } else if members.len() > 1 {
            TailKind::Trampoline
        } else if self_edge && !has_indirect {
            TailKind::SelfLoop
        } else if has_indirect {
            TailKind::Trampoline
        } else {
            TailKind::Normal
        };
        kinds.insert(name.clone(), kind);
        scc_members.insert(name.clone(), members);
    }
    TailAnalysis { kinds, scc_members }
}

struct Gen<'a> {
    user_names: BTreeSet<String>,
    export_names: BTreeSet<String>,
    stdlib_used: BTreeSet<String>,
    fresh_counter: usize,
    example_index: usize,
    function_names: Vec<(String, String)>,
    type_names: &'a BTreeSet<String>,
    tail_kinds: BTreeMap<String, TailKind>,
    scc_members: BTreeMap<String, BTreeSet<String>>,
    cur_tail: Option<TailCtx>,
    impure_defs: BTreeSet<String>,
    host_stack: Vec<String>,
    in_async: bool,
    uses_async: bool,
    decimal_used: bool,
}

impl<'a> Gen<'a> {
    fn new(input: &'a EmitInput) -> Self {
        let mut user_names = BTreeSet::new();
        let mut export_names = BTreeSet::new();
        for d in &input.defs {
            match d {
                CoreDef::Defn { name, .. } => {
                    user_names.insert(name.to_string());
                }
                CoreDef::Export { names, .. } => {
                    for n in names {
                        export_names.insert(n.to_string());
                    }
                }
                _ => {}
            }
        }
        let analysis = analyze_tail(&input.defs);
        let mut impure_defs: BTreeSet<String> = input.impure_names.clone();
        for d in &input.defs {
            if let CoreDef::Defn {
                name,
                pure: false,
                ..
            } = d
            {
                impure_defs.insert(name.to_string());
            }
        }
        let uses_async = defs_use_async(&input.defs, &impure_defs);
        Gen {
            user_names,
            export_names,
            stdlib_used: BTreeSet::new(),
            fresh_counter: 0,
            example_index: 0,
            function_names: Vec::new(),
            type_names: &input.type_names,
            tail_kinds: analysis.kinds,
            scc_members: analysis.scc_members,
            cur_tail: None,
            impure_defs,
            host_stack: Vec::new(),
            in_async: false,
            uses_async,
            decimal_used: defs_use_decimal(&input.defs),
        }
    }

    fn uses_trampoline(&self) -> bool {
        self.tail_kinds
            .values()
            .any(|k| matches!(k, TailKind::Trampoline))
    }

    fn fresh(&mut self) -> usize {
        self.fresh_counter += 1;
        self.fresh_counter
    }

    fn runtime_ref(&self, name: &str) -> String {
        if self.user_names.contains(name) {
            js_name(name)
        } else {
            name.to_string()
        }
    }

    fn var_ref(&mut self, name: &str) -> String {
        if self.user_names.contains(name) {
            return js_name(name);
        }
        if RUNTIME_EXPORTS.contains(&name) {
            return self.runtime_ref(name);
        }
        if stdlib().contains_key(name) {
            self.stdlib_used.insert(name.to_string());
            return stdlib_js_name(name);
        }
        js_name(name)
    }

    fn header(&self) -> String {
        let mut out = String::new();
        let imports: Vec<&str> = RUNTIME_EXPORTS
            .iter()
            .filter(|n| !self.user_names.contains(**n))
            .copied()
            .collect();
        if !imports.is_empty() {
            out += &format!("import {{ {} }} from \"./runtime.js\";\n", imports.join(", "));
        }
        if self.stdlib_used.contains("slice") || self.stdlib_used.contains("str-slice") {
            out += SLICE_BOUNDS_JS;
        }
        if self.stdlib_used.contains("str") {
            out += PRINT_JS;
        }
        for name in &self.stdlib_used {
            out += &format!("const {} = {};\n", stdlib_js_name(name), self.stdlib_impl(name));
        }
        if self.decimal_used {
            out += DEC_JS;
        }
        if !out.is_empty() {
            out.push('\n');
        }
        out
    }

    fn stdlib_impl(&self, name: &str) -> String {
        let se = self.runtime_ref("structuralEqual");
        match name {
            "+" => {
                if self.decimal_used {
                    "(a, b) => typeof a === \"bigint\" ? $dec_add(a, b) : a + b".to_string()
                } else {
                    "(a, b) => a + b".to_string()
                }
            }
            "-" => {
                if self.decimal_used {
                    "(a, b) => typeof a === \"bigint\" ? $dec_sub(a, b) : a - b".to_string()
                } else {
                    "(a, b) => a - b".to_string()
                }
            }
            "*" => {
                if self.decimal_used {
                    "(a, b) => typeof a === \"bigint\" ? $dec_mul(a, b) : a * b".to_string()
                } else {
                    "(a, b) => a * b".to_string()
                }
            }
            "/" => {
                if self.decimal_used {
                    "(a, b) => typeof a === \"bigint\" ? $dec_div(a, b) : a / b".to_string()
                } else {
                    "(a, b) => a / b".to_string()
                }
            }
            "<" => "(a, b) => a < b".to_string(),
            ">" => "(a, b) => a > b".to_string(),
            "<=" => "(a, b) => a <= b".to_string(),
            ">=" => "(a, b) => a >= b".to_string(),
            "=" => format!("(a, b) => {se}(a, b)"),
            "mod" => "(a, b) => a % b".to_string(),
            "abs" => "(a) => Math.abs(a)".to_string(),
            "min" => "(a, b) => { if (Number.isNaN(a)) return b; if (Number.isNaN(b)) return a; return a < b ? a : b; }".to_string(),
            "max" => "(a, b) => { if (Number.isNaN(a)) return b; if (Number.isNaN(b)) return a; return a > b ? a : b; }".to_string(),
            "not" => "(a) => !a".to_string(),
            "str" => {
                if self.decimal_used {
                    "(a) => typeof a === \"bigint\" ? $print_dec(a) : $print(a)".to_string()
                } else {
                    "(a) => $print(a)".to_string()
                }
            }
            "to-dec" => "(a) => $to_dec(a)".to_string(),
            "to-num" => "(a) => Number(a) / 1e18".to_string(),
            "str-concat" => "(...a) => a.join(\"\")".to_string(),
            "str-slice" => "(s, i, j) => { const c = [...s]; const [a, b] = $slice_bounds(c.length, i, j); return c.slice(a, b).join(\"\"); }".to_string(),
            "len" => "(s) => [...s].length".to_string(),
            "contains?" => "(s, t) => s.includes(t)".to_string(),
            // §11.6: 空区切りは各 Unicode スカラ値文字を1要素とし空要素を生まない（[...s] はコードポイント単位）
            "split" => "(s, t) => t === \"\" ? [...s] : s.split(t)".to_string(),
            "array" => "(...a) => a".to_string(),
            // §11.6: (union T nil) は実行時に生値。成功は arr[trunc(i)]、失敗は null(=nil)。
            "nth" => format!(
                "(arr, i) => {{ const k = Math.trunc(i); return (i >= 0 && k < arr.length) ? arr[k] : null; }}"
            ),
            "count" => "(arr) => arr.length".to_string(),
            "slice" => "(arr, i, j) => { const [a, b] = $slice_bounds(arr.length, i, j); return arr.slice(a, b); }".to_string(),
            "push" => "(arr, x) => [...arr, x]".to_string(),
            "concat" => "(arr, b) => [...arr, ...b]".to_string(),
            "map" => "(arr, f) => arr.map((x) => f(x))".to_string(),
            "filter" => "(arr, f) => arr.filter((x) => f(x))".to_string(),
            "fold-left" => "(arr, init, f) => arr.reduce((acc, x) => f(acc, x), init)".to_string(),
            // §11.6: 成功は生値 x、失敗は null(=nil)。
            "find" => format!(
                "(arr, f) => {{ for (const x of arr) if (f(x)) return x; return null; }}"
            ),
            "any?" => "(arr, f) => arr.some((x) => f(x))".to_string(),
            "all?" => "(arr, f) => arr.every((x) => f(x))".to_string(),
            other => format!(
                "(() => {{ throw new Error('unsupported stdlib: ' + {other:?}); }})"
            ),
        }
    }

    fn form_js(&mut self, d: &CoreDef, w: &mut JsWriter) {
        match d {
            CoreDef::Defn {
                name,
                params,
                body,
                span,
                pure,
                ..
            } => {
                let exported = if self.export_names.contains(name.as_ref()) {
                    "export "
                } else {
                    ""
                };
                let js = js_name(name);
                self.function_names.push((js.clone(), name.to_string()));
                let kind = self
                    .tail_kinds
                    .get(name.as_ref())
                    .copied()
                    .unwrap_or(TailKind::Normal);
                let params_js = params.iter().map(|p| js_name(&p.name)).collect::<Vec<_>>().join(", ");
                let param_names: Vec<String> = params.iter().map(|p| js_name(&p.name)).collect();
                // P1 (§12.4/§12.6): defn! は async 関数。host は第1引数（§12.6）。
                let async_kw = if *pure { "" } else { "async " };
                let saved_host_len = self.host_stack.len();
                if !*pure {
                    let h = params
                        .first()
                        .map(|p| js_name(&p.name))
                        .unwrap_or_else(|| "host".to_string());
                    self.host_stack.push(h);
                }
                let saved_async = self.in_async;
                self.in_async = !*pure;
                match kind {
                    TailKind::Normal => {
                        w.map_at(span, Some(name));
                        w.line(&format!("{exported}{async_kw}function {js}({params_js}) {{"));
                        self.stmt(body, "  ", w);
                        w.line("}");
                    }
                    TailKind::SelfLoop => {
                        w.map_at(span, Some(name));
                        w.line(&format!("{exported}{async_kw}function {js}({params_js}) {{"));
                        w.map_at(span, None);
                        w.line("  while (true) {");
                        let saved = self.cur_tail.replace(TailCtx::SelfLoop {
                            fn_js: js.clone(),
                            params: param_names,
                        });
                        self.stmt(body, "    ", w);
                        self.cur_tail = saved;
                        w.line("  }");
                        w.line("}");
                    }
                    TailKind::Trampoline => {
                        let inner = format!("{js}$inner");
                        let members = self
                            .scc_members
                            .get(name.as_ref())
                            .cloned()
                            .unwrap_or_else(|| BTreeSet::from([name.to_string()]));
                        w.map_at(span, Some(name));
                        w.line(&format!("{async_kw}function {inner}({params_js}) {{"));
                        let saved = self.cur_tail.replace(TailCtx::Trampoline { members });
                        self.stmt(body, "  ", w);
                        self.cur_tail = saved;
                        w.line("}");
                        w.map_at(span, Some(name));
                        w.line(&format!(
                            "{exported}{async_kw}function {js}({params_js}) {{ return $run({inner}({params_js})); }}"
                        ));
                    }
                }
                self.in_async = saved_async;
                self.host_stack.truncate(saved_host_len);
            }
            CoreDef::Import {
                path,
                names,
                span,
            } => {
                let value_names: Vec<String> = names
                    .iter()
                    .filter(|n| !self.type_names.contains(n.as_ref()))
                    .map(|n| js_name(n))
                    .collect();
                if value_names.is_empty() {
                    return;
                }
                let js_path = path.trim_end_matches(".lts").to_string() + ".js";
                w.map_at(span, None);
                w.line(&format!(
                    "import {{ {} }} from {};",
                    value_names.join(", "),
                    serde_json::to_string(&js_path).unwrap_or_else(|_| format!("\"{js_path}\""))
                ));
            }
            CoreDef::Example {
                actual,
                expected,
                span,
                ..
            } => {
                let i = self.example_index;
                self.example_index += 1;
                let se = self.runtime_ref("structuralEqual");
                // P1: モジュールが async を含む場合、example は defn! を呼びうるので await で包む。
                let saved_async = self.in_async;
                self.in_async = self.uses_async;
                w.map_at(span, None);
                w.line("{");
                w.write("  const actual = ");
                self.expr(actual, "  ", w);
                w.write(";\n");
                w.write("  const expected = ");
                self.expr(expected, "  ", w);
                w.write(";\n");
                self.in_async = saved_async;
                let ser = if self.decimal_used { "$json(actual)" } else { "JSON.stringify(actual)" };
                w.line(&format!(
                    "  if (!{se}(actual, expected)) throw new Error(\"example {i} failed: \" + {ser});"
                ));
                w.line(&format!(
                    "  console.log(\"example {i}: ok \" + {ser});"
                ));
                w.line("}");
            }
            _ => {}
        }
    }

    fn stmt(&mut self, e: &Core, ind: &str, w: &mut JsWriter) {
        w.map_at(e.span(), None);
        if let Some(ctx) = self.cur_tail.clone() {
            if let Core::App { f, args, .. } = e {
                let is_self = match &ctx {
                    TailCtx::SelfLoop { fn_js, .. } => {
                        matches!(f.as_ref(), Core::Var { name, .. } if js_name(name) == *fn_js)
                    }
                    TailCtx::Trampoline { .. } => false,
                };
                if is_self || matches!(ctx, TailCtx::Trampoline { .. }) {
                    match &ctx {
                        TailCtx::SelfLoop { params, .. } => {
                            let temps: Vec<String> =
                                (0..args.len()).map(|_| format!("$a{}", self.fresh())).collect();
                            for (t, a) in temps.iter().zip(args.iter()) {
                                w.write(&format!("{ind}const {t} = "));
                                self.expr(a, ind, w);
                                w.write(";\n");
                            }
                            for (p, t) in params.iter().zip(temps.iter()) {
                                w.line(&format!("{ind}{p} = {t};"));
                            }
                            w.line(&format!("{ind}continue;"));
                        }
                        TailCtx::Trampoline { members } => {
                            let member = match f.as_ref() {
                                Core::Var { name, .. } if members.contains(name.as_ref()) => {
                                    Some(format!("{}$inner", js_name(name)))
                                }
                                _ => None,
                            };
                            w.write(&format!("{ind}return $thunk("));
                            match member {
                                Some(m) => w.write(&m),
                                None => self.expr(f, ind, w),
                            }
                            w.write(", [");
                            for (i, a) in args.iter().enumerate() {
                                if i > 0 {
                                    w.write(", ");
                                }
                                self.expr(a, ind, w);
                            }
                            w.write("]);\n");
                        }
                    }
                    return;
                }
            }
        }
        match e {
            Core::Do { .. } => self.do_stmt(e, ind, w),
            Core::If {
                cond,
                then,
                else_,
                ..
            } => {
                w.write(&format!("{ind}if ("));
                self.expr(cond, ind, w);
                w.write(") {\n");
                self.stmt(then, &format!("{ind}  "), w);
                w.write(&format!("\n{ind}}} else {{\n"));
                self.stmt(else_, &format!("{ind}  "), w);
                w.write(&format!("\n{ind}}}\n"));
            }
            Core::Let {
                name, rhs, body, ..
            } => {
                w.write(&format!("{ind}const {} = ", js_name(name)));
                self.expr(rhs, ind, w);
                w.write(";\n");
                self.stmt(body, ind, w);
            }
            Core::Match { .. } => self.match_tail(e, ind, w, None),
            _ => {
                w.write(&format!("{ind}return "));
                self.expr(e, ind, w);
                w.write(";\n");
            }
        }
    }

    fn do_stmt(&mut self, e: &Core, ind: &str, w: &mut JsWriter) {
        let Core::Do { binds, body, .. } = e else {
            return;
        };
        for b in binds {
            let r = format!("$r{}", self.fresh());
            let is_effect = matches!(b.expr, Core::EffectCall { .. });
            w.write(&format!("{ind}const {r} = "));
            self.expr(&b.expr, ind, w);
            w.write(";\n");
            if is_effect {
                // §7.4 rule 5: defn! 内のエフェクト呼び出しは Result とは限らない。interp と同じく
                // Err なら早期 return、束縛値は Ok なら中身、それ以外はそのまま。
                w.line(&format!(
                    "{ind}if ({r} !== null && {r}.tag === \"Err\") return {r};"
                ));
                if b.name.as_ref() != "_" {
                    w.line(&format!(
                        "{ind}const {} = ({r} !== null && {r}.tag === \"Ok\") ? {r}.value : {r};",
                        js_name(&b.name)
                    ));
                }
            } else {
                w.line(&format!("{ind}if ({r}.tag === \"Err\") return {r};"));
                if b.name.as_ref() != "_" {
                    w.line(&format!("{ind}const {} = {r}.value;", js_name(&b.name)));
                }
            }
        }
        self.stmt(body, ind, w);
    }

    fn match_tail(&mut self, e: &Core, ind: &str, w: &mut JsWriter, bound: Option<&str>) {
        let Core::Match {
            scrutinee, arms, ..
        } = e
        else {
            return;
        };
        let s = match bound {
            Some(b) => b.to_string(),
            None => {
                let s = format!("$s{}", self.fresh());
                w.write(&format!("{ind}const {s} = "));
                self.expr(scrutinee, ind, w);
                w.write(";\n");
                s
            }
        };
        let mut first = true;
        let mut has_catch_all = false;
        for arm in arms {
            let cond = self.arm_cond(&arm.pattern, &s);
            w.write(ind);
            if cond == "true" {
                has_catch_all = true;
                w.write("else {\n");
            } else {
                w.write(if first { "if" } else { "else if" });
                w.write(&format!(" ({cond}) {{\n"));
                first = false;
            }
            let mut binds_out: Vec<String> = Vec::new();
            self.arm_binds(&arm.pattern, &s, &format!("{ind}  "), &mut binds_out);
            for b in binds_out {
                w.line(&b);
            }
            self.stmt(&arm.body, &format!("{ind}  "), w);
            w.write(&format!("\n{ind}}}\n"));
        }
        if !has_catch_all {
            w.write(&format!("{ind}else {{\n{ind}  throw new Error(\"non-exhaustive match\");\n{ind}}}\n"));
        }
    }

    fn arm_cond(&mut self, p: &crate::ir::Pat, s: &str) -> String {
        use crate::ir::PatKind;
        match &p.kind {
            PatKind::Wildcard | PatKind::Var(_) => "true".to_string(),
            PatKind::Lit(v) => format!("{s} === {}", lit_js(v)),
            PatKind::Or(ps) => ps
                .iter()
                .map(|sub| format!("({})", self.arm_cond(sub, s)))
                .collect::<Vec<_>>()
                .join(" || "),
            PatKind::Obj(fields) => {
                let mut conds = vec![format!(
                    "typeof {s} === \"object\" && {s} !== null && !Array.isArray({s})"
                )];
                for (n, sub) in fields {
                    conds.push(format!("({})", self.arm_cond(sub, &format!("{s}.{}", js_name(n)))));
                }
                conds.join(" && ")
            }
            PatKind::Array(elements) => {
                let mut conds = vec![format!("Array.isArray({s})"), format!("{s}.length === {}", elements.len())];
                for (i, el) in elements.iter().enumerate() {
                    conds.push(format!("({})", self.arm_cond(el, &format!("{s}[{i}]"))));
                }
                conds.join(" && ")
            }
        }
    }

    fn arm_binds(&mut self, p: &crate::ir::Pat, s: &str, ind: &str, out: &mut Vec<String>) {
        use crate::ir::PatKind;
        match &p.kind {
            PatKind::Var(name) => out.push(format!("{ind}const {} = {s};", js_name(name))),
            PatKind::Obj(fields) => {
                for (n, sub) in fields {
                    self.arm_binds(sub, &format!("{s}.{}", js_name(n)), ind, out);
                }
            }
            PatKind::Array(elements) => {
                for (i, el) in elements.iter().enumerate() {
                    self.arm_binds(el, &format!("{s}[{i}]"), ind, out);
                }
            }
            _ => {}
        }
    }

    fn expr(&mut self, e: &Core, ind: &str, w: &mut JsWriter) {
        // async 文脈（defn! 本体やエフェクトを含む lam）では呼び出し結果が Promise になりうるので
        // await で包む（§12.4 の `await host.name(args)` と同じ扱い）。非同期でない値への await は恒等。
        if self.in_async && matches!(e, Core::App { .. } | Core::EffectCall { .. }) {
            w.write("(await ");
            self.expr_inner(e, ind, w);
            w.write(")");
            return;
        }
        self.expr_inner(e, ind, w);
    }

    fn expr_inner(&mut self, e: &Core, ind: &str, w: &mut JsWriter) {
        w.map_at(e.span(), None);
        match e {
            Core::Lit { value, .. } => w.write(&lit_js(value)),
            Core::Var { name, .. } => {
                let n = name.clone();
                let r = self.var_ref(&n);
                w.write(&r);
            }
            Core::Lam {
                params, body, ..
            } => {
                let params_js = params.iter().map(|p| js_name(&p.name)).collect::<Vec<_>>().join(", ");
                let lam_async = core_has_effect_call(body) || core_calls_impure(body, &self.impure_defs);
                let async_kw = if lam_async { "async " } else { "" };
                w.write(&format!("({async_kw}({params_js}) => {{\n"));
                let saved = self.cur_tail.take();
                let saved_async = self.in_async;
                self.in_async = lam_async;
                self.stmt(body, &format!("{ind}  "), w);
                self.in_async = saved_async;
                self.cur_tail = saved;
                w.write(&format!("{ind}}})"));
            }
            Core::App { f, args, .. } => {
                if let Core::Var { name, .. } = f.as_ref() {
                    let n = name.as_ref();
                    if !self.user_names.contains(n) {
                        if n == "bind" && args.len() == 2 {
                            w.write("(($b) => $b.tag === \"Ok\" ? (");
                            self.expr(&args[1], ind, w);
                            w.write(")($b.value) : $b)(");
                            self.expr(&args[0], ind, w);
                            w.write(")");
                            return;
                        }
                        if n == "map-result" && args.len() == 2 {
                            let ok = self.runtime_ref("ok");
                            w.write(&format!("(($b) => $b.tag === \"Ok\" ? {ok}("));
                            self.expr(&args[1], ind, w);
                            w.write(")($b.value) : $b)(");
                            self.expr(&args[0], ind, w);
                            w.write(")");
                            return;
                        }
                        if n == "traverse" && args.len() == 2 {
                            let ok = self.runtime_ref("ok");
                            w.write("(($arr) => { const $out = []; for (const $x of ");
                            self.expr(&args[0], ind, w);
                            w.write(") { const $r = (");
                            self.expr(&args[1], ind, w);
                            w.write(")($x); if ($r.tag === \"Err\") return $r; $out.push($r.value); } return ");
                            w.write(&ok);
                            w.write("($out); })()");
                            return;
                        }
                    }
                }
                self.expr(f, ind, w);
                w.write("(");
                for (i, a) in args.iter().enumerate() {
                    if i > 0 {
                        w.write(", ");
                    }
                    self.expr(a, ind, w);
                }
                w.write(")");
            }
            Core::Let {
                name, rhs, body, ..
            } => {
                if self.in_async {
                    w.write(&format!("(await (async ({}) => {{\n", js_name(name)));
                    self.stmt(body, &format!("{ind}  "), w);
                    w.write(&format!("{ind}}})("));
                    self.expr(rhs, ind, w);
                    w.write("))");
                } else {
                    w.write(&format!("(({}) => {{\n", js_name(name)));
                    self.stmt(body, &format!("{ind}  "), w);
                    w.write(&format!("{ind}}})("));
                    self.expr(rhs, ind, w);
                    w.write(")");
                }
            }
            Core::If {
                cond,
                then,
                else_,
                ..
            } => {
                w.write("(");
                self.expr(cond, ind, w);
                w.write(" ? ");
                self.expr(then, ind, w);
                w.write(" : ");
                self.expr(else_, ind, w);
                w.write(")");
            }
            Core::Match { .. } => {
                let s = format!("$s{}", self.fresh());
                if self.in_async {
                    w.write(&format!("(await (async ({s}) => {{\n"));
                    self.match_tail(e, &format!("{ind}  "), w, Some(&s));
                    w.write(&format!("{ind}}})("));
                    if let Core::Match { scrutinee, .. } = e {
                        self.expr(scrutinee, ind, w);
                    }
                    w.write("))");
                } else {
                    w.write(&format!("(({s}) => {{\n"));
                    self.match_tail(e, &format!("{ind}  "), w, Some(&s));
                    w.write(&format!("{ind}}})("));
                    if let Core::Match { scrutinee, .. } = e {
                        self.expr(scrutinee, ind, w);
                    }
                    w.write(")");
                }
            }
            Core::Obj { fields, .. } => {
                w.write("{ ");
                for (i, (n, c)) in fields.iter().enumerate() {
                    if i > 0 {
                        w.write(", ");
                    }
                    w.write(&format!("{}: ", js_name(n)));
                    self.expr(c, ind, w);
                }
                w.write(" }");
            }
            Core::Field { obj, name, .. } => {
                w.write("(");
                self.expr(obj, ind, w);
                w.write(&format!(").{}", js_name(name)));
            }
            Core::Do { .. } => {
                if self.in_async {
                    w.write("(await (async () => {\n");
                    self.do_stmt(e, &format!("{ind}  "), w);
                    w.write(&format!("{ind}}})())"));
                } else {
                    w.write("(() => {\n");
                    self.do_stmt(e, &format!("{ind}  "), w);
                    w.write(&format!("{ind}}})()"));
                }
            }
            Core::EffectCall { effect, args, .. } => {
                if self.in_async {
                    // §12.4: EffectCall -> `await host.name(args)`（host は囲む defn! の第1引数 §12.6）。
                    // 外側の expr ラッパが (await ...) で包む。
                    let h = self
                        .host_stack
                        .last()
                        .cloned()
                        .unwrap_or_else(|| "host".to_string());
                    w.write(&format!("{h}{}(", effect_prop(effect)));
                    for (i, a) in args.iter().enumerate() {
                        if i > 0 {
                            w.write(", ");
                        }
                        self.expr(a, ind, w);
                    }
                    w.write(")");
                } else {
                    w.write(&format!(
                        "(() => {{ throw new Error({}); }})()",
                        serde_json::to_string(&format!(
                            "エフェクト {effect}! は defn! 本体の外では実行できません"
                        ))
                        .unwrap_or_else(|_| "\"effect\"".to_string())
                    ));
                }
            }
            Core::Error { message, .. } => {
                w.write(&format!(
                    "(() => {{ throw new Error({}); }})()",
                    serde_json::to_string(message).unwrap_or_else(|_| "\"error\"".to_string())
                ));
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::desugar::desugar;
    use crate::lexer::tokenize;
    use crate::parser::parse_program;

    fn emit_src(src: &str) -> Result<EmitOutput, Vec<Diagnostic>> {
        let lex = tokenize(src, "test.lts");
        let (program, _) = parse_program(&lex);
        let (defs, _) = desugar(&program);
        emit(&EmitInput {
            defs,
            file: "test.js".to_string(),
            source_file: "test.lts".to_string(),
            type_names: BTreeSet::new(),
            impure_names: BTreeSet::new(),
        })
    }

    #[test]
    fn js_name_table() {
        assert_eq!(js_name("add-money"), "add_money");
        assert_eq!(js_name("contains?"), "contains_q");
        assert_eq!(js_name("any?"), "any_q");
        assert_eq!(js_name("class"), "$class");
        assert_eq!(js_name("new"), "$new");
        assert_eq!(js_name("zero"), "zero");
        assert_eq!(js_name("fold-left"), "fold_left");
    }

    #[test]
    fn do_lowers_to_early_return() {
        let out = emit_src(
            "(defn f (items : (Array number)) : (Result number string) (do [_ (g items)] [t (h items)] (ok t)))",
        )
        .expect("emit");
        assert!(out.js.contains(".tag === \"Err\") return $r"), "{}", out.js);
        assert!(out.js.contains("const $r1 = "), "{}", out.js);
    }

    #[test]
    fn bind_map_result_traverse_are_inlined() {
        let out = emit_src(
            "(defn f (x : (Result number string)) : (Result number string) (bind x (fn (n : number) : (Result number string) (map-result x (fn (m : number) : number m)))))",
        )
        .expect("emit");
        assert!(out.js.contains("$b.tag === \"Ok\""), "{}", out.js);
        assert!(!out.js.contains("$stdlib_bind"), "{}", out.js);
        assert!(!out.js.contains("$stdlib_map_result"), "{}", out.js);
    }

    #[test]
    fn defn_bang_emits_async_function_with_host_call() {
        let out = emit_src(
            "(effect log : (fn (s : string) : nil))\n(defn! f (host : (obj (log : (fn (s : string) : nil)))) (s : string) : nil (log! s))",
        )
        .expect("defn! は P1 で生成できる");
        assert!(out.js.contains("async function f(host, s)"), "{}", out.js);
        assert!(out.js.contains("(await host.log(s))"), "{}", out.js);
    }

    #[test]
    fn defn_bang_example_is_awaited_and_kebab_effect_uses_snake_case_key() {
        let out = emit_src(
            "(effect db-write : (fn (s : string) : nil))\n(defn! f (host : (obj (db-write : (fn (s : string) : nil)))) : nil (db-write! \"x\"))\n(example (f (obj (db-write (fn (s : string) : nil nil)))) => nil)",
        )
        .expect("emit");
        assert!(out.js.contains("(await host.db_write(\"x\"))"), "{}", out.js);
        assert!(out.js.contains("const actual = (await f("), "{}", out.js);
    }

    #[test]
    fn pure_module_has_no_async_anywhere() {
        let out = emit_src(
            "(defn add-money (a : number) : number (+ a 1))\n(example (add-money 1) => 2)",
        )
        .expect("emit");
        assert!(!out.js.contains("async"), "{}", out.js);
        assert!(!out.js.contains("await"), "{}", out.js);
        assert!(out.js.contains("const actual = add_money(1);"), "{}", out.js);
    }

    #[test]
    fn emit_is_deterministic() {
        let src = "(defn add-money (a : number) : number (+ a 1))\n(example (add-money 1) => 2)";
        let a = emit_src(src).expect("a");
        let b = emit_src(src).expect("b");
        assert_eq!(a.js, b.js);
        assert_eq!(a.map, b.map);
        let map_json: serde_json::Value = serde_json::from_str(&a.map).expect("map json");
        assert_eq!(map_json["version"], 3);
        assert_eq!(map_json["sources"], serde_json::json!(["test.lts"]));
    }

    #[test]
    fn option_and_split_stdlib_lowering_is_raw_and_scalar_based() {
        let out = emit_src(
            "(defn f (arr : (Array number)) : (Option number) (find arr (fn (x : number) : bool (> x 0))))\n(defn g (arr : (Array number)) (i : number) : (Option number) (nth arr i))\n(defn h (s : string) (t : string) : (Array string) (split s t))",
        )
        .expect("emit");
        assert!(out.js.contains("? arr[k] : null"), "{}", out.js);
        assert!(!out.js.contains("{ok}(arr[k])"), "{}", out.js);
        assert!(out.js.contains("if (f(x)) return x; return null;"), "{}", out.js);
        assert!(out.js.contains("t === \"\" ? [...s] : s.split(t)"), "{}", out.js);
    }

    #[test]
    fn decimal_literals_lower_to_bigint_and_helpers_are_emitted() {
        let out = emit_src(
            "(defn f (a : decimal) (b : decimal) : decimal (* a b))\n(example (f 1.50d 2.00d) => 3.00d)",
        )
        .expect("emit");
        assert!(out.js.contains("1500000000000000000n"), "{}", out.js);
        assert!(out.js.contains("$dec_mul"), "{}", out.js);
        assert!(out.js.contains("$json(actual)"), "{}", out.js);
    }

    #[test]
    fn pure_number_module_has_no_decimal_helpers() {
        let out = emit_src("(defn add (a : number) (b : number) : number (+ a b))\n(example (add 1 2) => 3)").expect("emit");
        assert!(!out.js.contains("$dec_mul"), "{}", out.js);
        assert!(!out.js.contains("bigint"), "{}", out.js);
        assert!(out.js.contains("const $stdlib_add = (a, b) => a + b;"), "{}", out.js);
    }
}
