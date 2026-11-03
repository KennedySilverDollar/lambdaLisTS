use std::collections::BTreeSet;
use std::rc::Rc;

use serde_json::{json, Value as Json};

use crate::check::{check_file, create_context, ModuleCache};
use crate::desugar::{desugar, desugar_expr, CoreDef};
use crate::eval::{global_env, load_defs, load_file, run_examples, Interp};
use crate::lexer::tokenize;
use crate::parser::{parse_expr, parse_program};
use crate::types::{normalize_type, print_type};
use crate::value::{print_value, Env};

pub struct Repl {
    defs: Vec<CoreDef>,
    context_file: String,
    env: Rc<Env>,
    cache: ModuleCache,
}

impl Default for Repl {
    fn default() -> Self {
        Self::new()
    }
}

impl Repl {
    pub fn new() -> Self {
        Repl {
            defs: Vec::new(),
            context_file: "repl.lts".to_string(),
            env: global_env(),
            cache: ModuleCache::default(),
        }
    }

    pub fn handle_line(&mut self, line: &str) -> Option<String> {
        let req: Json = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(e) => {
                return Some(
                    serde_json::to_string(&json!({
                        "ok": false,
                        "errors": [{ "kind": "parse-error", "message": format!("invalid JSON line: {e}") }]
                    }))
                    .unwrap_or_else(|_| "{}".to_string()),
                );
            }
        };
        self.handle(&req)
            .map(|r| serde_json::to_string(&r).unwrap_or_else(|_| "{}".to_string()))
    }

    fn handle(&mut self, req: &Json) -> Option<Json> {
        let id = req["id"].clone();
        match req["op"].as_str() {
            Some("quit") => None,
            Some("eval") => Some(self.eval(id, req["src"].as_str().unwrap_or(""))),
            Some("test") => Some(self.test(id)),
            Some("prop") => Some(json!({
                "id": id,
                "ok": false,
                "errors": [{ "kind": "unsupported-in-p0", "message": "prop評価はP1で実装" }]
            })),
            Some("reload") => Some(self.reload(id, req["file"].as_str().unwrap_or(""))),
            Some("type-of") => Some(self.type_of(id, req["src"].as_str().unwrap_or(""))),
            other => Some(json!({
                "id": id,
                "ok": false,
                "errors": [{ "kind": "parse-error", "message": format!("unknown op: {}", other.unwrap_or("")) }]
            })),
        }
    }

    fn eval(&mut self, id: Json, src: &str) -> Json {
        let lex = tokenize(src, "repl.lts");
        let (program, lex_diags) = parse_program(&lex);
        if !lex_diags.is_empty() {
            return json!({ "id": id, "ok": false, "errors": lex_diags });
        }
        let (ds_defs, ds_diags) = desugar(&program);
        if !ds_diags.is_empty() {
            return json!({ "id": id, "ok": false, "errors": ds_diags });
        }
        let mut all = self.defs.clone();
        all.extend(ds_defs.iter().cloned());
        let (result, _checker) = create_context(&all, &self.context_file, &mut self.cache);
        if !result.diagnostics.is_empty() {
            return json!({ "id": id, "ok": false, "errors": result.diagnostics });
        }
        self.defs = all;
        load_defs(&ds_defs, &self.env);
        if let Some(CoreDef::Defn { name, .. }) = ds_defs.iter().rev().find(|d| matches!(d, CoreDef::Defn { .. })) {
            let type_str = match result.value_types.get(name) {
                Some(t) => print_type(
                    &normalize_type(t, &result.type_aliases),
                    &result.type_aliases,
                ),
                None => "?".to_string(),
            };
            return json!({ "id": id, "ok": true, "defined": name.as_ref(), "type": type_str });
        }
        json!({ "id": id, "ok": true })
    }

    fn test(&mut self, id: Json) -> Json {
        let all = self.defs.clone();
        load_defs(&all, &self.env);
        let mut interp = Interp::new();
        match run_examples(&mut interp, &all, &self.env) {
            Ok(results) => {
                if results.iter().all(|r| r.pass) {
                    json!({
                        "id": id,
                        "ok": true,
                        "results": results.iter().map(|r| json!({
                            "example": format!("example {}", r.index),
                            "pass": r.pass
                        })).collect::<Vec<_>>()
                    })
                } else {
                    json!({
                        "id": id,
                        "ok": false,
                        "failures": results.iter().filter(|r| !r.pass).map(|r| json!({
                            "example": format!("example {}", r.index),
                            "actual": print_value(&r.actual),
                            "expected": print_value(&r.expected)
                        })).collect::<Vec<_>>()
                    })
                }
            }
            Err(e) => json!({
                "id": id,
                "ok": false,
                "errors": [{ "kind": "internal-error", "message": e.to_string() }]
            }),
        }
    }

    fn reload(&mut self, id: Json, file: &str) -> Json {
        let abs = if std::path::Path::new(file).is_absolute() {
            file.to_string()
        } else {
            match std::env::current_dir() {
                Ok(cwd) => cwd.join(file).to_string_lossy().into_owned(),
                Err(_) => file.to_string(),
            }
        };
        let checked = check_file(&abs, &mut self.cache);
        if !checked.diagnostics.is_empty() {
            return json!({ "id": id, "ok": false, "errors": checked.diagnostics });
        }
        let mut seen = BTreeSet::new();
        match load_file(&abs, &self.env, &mut seen) {
            Ok(defs) => {
                self.defs.extend(defs);
                self.context_file = abs;
                json!({ "id": id, "ok": true })
            }
            Err(e) => json!({
                "id": id,
                "ok": false,
                "errors": [{ "kind": "internal-error", "message": e.to_string() }]
            }),
        }
    }

    fn type_of(&mut self, id: Json, src: &str) -> Json {
        let (expr, diags) = parse_expr(src, "repl.lts");
        if !diags.is_empty() {
            return json!({ "id": id, "ok": false, "errors": diags });
        }
        let Some(expr) = expr else {
            return json!({
                "id": id,
                "ok": false,
                "errors": [{ "kind": "parse-error", "message": "式としてパースできません" }]
            });
        };
        let core = desugar_expr(&expr);
        let (result, mut checker) = create_context(&self.defs, &self.context_file, &mut self.cache);
        if !result.diagnostics.is_empty() {
            return json!({ "id": id, "ok": false, "errors": result.diagnostics });
        }
        let t = checker.infer(&core, "(repl)");
        json!({
            "id": id,
            "ok": true,
            "type": print_type(&normalize_type(&t, &result.type_aliases), &result.type_aliases)
        })
    }
}

pub fn run() -> std::io::Result<()> {
    use std::io::{BufRead, Write};
    let stdin = std::io::stdin();
    let stdout = std::io::stdout();
    let mut repl = Repl::new();
    let mut out = stdout.lock();
    for line in stdin.lock().lines() {
        let line = line?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        match repl.handle_line(trimmed) {
            Some(s) => writeln!(out, "{s}")?,
            None => break,
        }
    }
    Ok(())
}
