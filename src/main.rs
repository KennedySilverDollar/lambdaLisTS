#![forbid(unsafe_code)]

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::process::ExitCode;

use clap::{Parser, Subcommand};

use lists::check::{check_file, ModuleCache};
use lists::desugar::desugar;
use lists::diagnostic::{DiagKind, Diagnostic, Severity};
use lists::emit::{emit, EmitInput};
use lists::fmt::format_source;
use lists::lexer::tokenize;
use lists::parser::parse_program;
use lists::repl;
use lists::runtime::RUNTIME_JS;
use lists::span::Span;
use std::rc::Rc;

#[derive(Parser)]
#[command(name = "lists", version, about = "λ LisTS P0 compiler (Rust edition)")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    Compile {
        files: Vec<PathBuf>,
        #[arg(long)]
        out: Option<PathBuf>,
    },
    Fmt {
        files: Vec<PathBuf>,
    },
    Repl,
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    match cli.command {
        Commands::Compile { files, out } => ExitCode::from(compile(&files, out.as_deref()) as u8),
        Commands::Fmt { files } => ExitCode::from(fmt_cmd(&files) as u8),
        Commands::Repl => {
            match repl::run() {
                Ok(()) => ExitCode::SUCCESS,
                Err(e) => {
                    eprintln!("repl error: {e}");
                    ExitCode::from(2)
                }
            }
        }
    }
}

fn out_path_for(file: &Path, out_dir: Option<&Path>) -> PathBuf {
    let base = file
        .file_name()
        .map(|n| n.to_string_lossy().replace(".lts", ".js"))
        .unwrap_or_else(|| "out.js".to_string());
    match out_dir {
        Some(d) => d.join(base),
        None => file.parent().unwrap_or(Path::new("")).join(base),
    }
}

fn read_diag(file: &str, message: String) -> Diagnostic {
    Diagnostic {
        kind: DiagKind::ImportNotFound,
        severity: Severity::Error,
        span: Span {
            file: Rc::from(file),
            start: 0,
            end: 0,
            line: 1,
            col: 1,
        },
        message,
        data: None,
        fix: None,
    }
}

fn compile(files: &[PathBuf], out_dir: Option<&Path>) -> i32 {
    let mut diagnostics: Vec<Diagnostic> = Vec::new();
    let out_root = match out_dir {
        Some(d) => {
            let _ = std::fs::create_dir_all(d);
            d.to_path_buf()
        }
        None => files
            .first()
            .and_then(|f| f.parent().map(|p| p.to_path_buf()))
            .unwrap_or_else(|| PathBuf::from(".")),
    };
    for file in files {
        let file_s = file.to_string_lossy().into_owned();
        let src = match std::fs::read_to_string(file) {
            Ok(s) => s,
            Err(e) => {
                diagnostics.push(read_diag(&file_s, format!("ファイルを読めません: '{file_s}': {e}")));
                continue;
            }
        };
        let lex = tokenize(&src, &file_s);
        let (program, parse_diags) = parse_program(&lex);
        diagnostics.extend(lex.diagnostics.iter().cloned());
        diagnostics.extend(parse_diags);
        let (defs, ds_diags) = desugar(&program);
        diagnostics.extend(ds_diags);
        let mut cache = ModuleCache::default();
        let checked = check_file(&file_s, &mut cache);
        diagnostics.extend(checked.diagnostics.iter().cloned());
        let type_names: BTreeSet<String> = checked.type_aliases.keys().map(|k| k.to_string()).collect();
        let out_path = out_path_for(file, out_dir);
        let out_name = out_path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| "out.js".to_string());
        let source_name = file
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_else(|| file_s.clone());
        match emit(&EmitInput {
            defs,
            file: out_name,
            source_file: source_name,
            type_names,
        }) {
            Ok(out) => {
                if let Some(parent) = out_path.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                let _ = std::fs::write(&out_path, &out.js);
                let _ = std::fs::write(format!("{}.map", out_path.display()), &out.map);
            }
            Err(errs) => diagnostics.extend(errs),
        }
    }
    let runtime_path = out_root.join("runtime.js");
    if !runtime_path.exists() {
        let _ = std::fs::write(&runtime_path, RUNTIME_JS);
    }
    println!(
        "{}",
        serde_json::to_string(&diagnostics).unwrap_or_else(|_| "[]".to_string())
    );
    if diagnostics.is_empty() {
        0
    } else {
        1
    }
}

fn fmt_cmd(files: &[PathBuf]) -> i32 {
    let mut diagnostics: Vec<Diagnostic> = Vec::new();
    for file in files {
        let file_s = file.to_string_lossy().into_owned();
        let src = match std::fs::read_to_string(file) {
            Ok(s) => s,
            Err(e) => {
                diagnostics.push(read_diag(&file_s, format!("ファイルを読めません: '{file_s}': {e}")));
                continue;
            }
        };
        let r = format_source(&src, &file_s);
        let had_err = !r.diagnostics.is_empty();
        diagnostics.extend(r.diagnostics);
        if !had_err {
            let _ = std::fs::write(file, &r.output);
        }
    }
    println!(
        "{}",
        serde_json::to_string(&diagnostics).unwrap_or_else(|_| "[]".to_string())
    );
    if diagnostics.is_empty() {
        0
    } else {
        1
    }
}
