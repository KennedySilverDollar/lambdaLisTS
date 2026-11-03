use sourcemap::{SourceMap, SourceMapBuilder};

use crate::span::Span;

pub struct MapBuilder {
    builder: SourceMapBuilder,
    source_file: String,
}

impl MapBuilder {
    pub fn new(out_file: &str, source_file: &str) -> Self {
        let mut builder = SourceMapBuilder::new(Some(out_file));
        builder.add_source(source_file);
        MapBuilder {
            builder,
            source_file: source_file.to_string(),
        }
    }

    pub fn add(&mut self, gen_line: u32, gen_col: u32, span: &Span, name: Option<&str>) {
        self.builder.add(
            gen_line,
            gen_col,
            span.line.saturating_sub(1) as u32,
            span.col.saturating_sub(1) as u32,
            Some(&self.source_file),
            name,
            false,
        );
    }

    pub fn to_json(self) -> String {
        let map: SourceMap = self.builder.into_sourcemap();
        let mut buf = Vec::new();
        match map.to_writer(&mut buf) {
            Ok(()) => String::from_utf8(buf).unwrap_or_else(|_| "{}".to_string()),
            Err(_) => "{}".to_string(),
        }
    }
}
