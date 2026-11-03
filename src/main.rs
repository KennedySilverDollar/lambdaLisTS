#![forbid(unsafe_code)]

use std::path::PathBuf;

use clap::{Parser, Subcommand};

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

fn main() {
    let cli = Cli::parse();
    match cli.command {
        Commands::Compile { .. } => println!("lists compile: not implemented yet (P0 scaffold)"),
        Commands::Fmt { .. } => println!("lists fmt: not implemented yet (P0 scaffold)"),
        Commands::Repl => println!("lists repl: not implemented yet (P0 scaffold)"),
    }
}
