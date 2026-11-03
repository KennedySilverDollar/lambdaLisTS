use std::path::PathBuf;
use std::rc::Rc;

use crate::diagnostic::Diagnostic;

#[derive(Debug, Clone)]
pub struct Module {
    pub path: PathBuf,
    pub exports: Vec<Rc<str>>,
}

pub fn resolve(_entry: &PathBuf) -> Result<Vec<Module>, Vec<Diagnostic>> {
    unimplemented!("resolver: import解決/export検査/循環検出 — P0 未実装")
}
