use sourcemap::SourceMapBuilder;

use crate::span::Span;

pub fn build_map(_dst_file: &str, _src_file: &str, _spans: &[Span]) -> SourceMapBuilder {
    unimplemented!("sourcemap_out: source map v3 生成 — P0 未実装")
}

pub fn to_json(_builder: &SourceMapBuilder) -> String {
    unimplemented!("sourcemap_out: P0 未実装")
}
