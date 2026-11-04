#![forbid(unsafe_code)]

pub mod ast;
pub mod backends;
pub mod check;
pub mod desugar;
pub mod diagnostic;
pub mod effects;
pub mod emit;
pub mod eval;
pub mod exhaustive;
pub mod fmt;
pub mod ir;
pub mod lexer;
pub mod parser;
pub mod repl;
pub mod resolver;
pub mod runtime;
pub mod sourcemap_out;
pub mod span;
pub mod stdlib;
pub mod token;
pub mod types;
pub mod unify;
pub mod value;
