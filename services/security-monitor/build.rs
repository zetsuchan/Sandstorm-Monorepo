use libbpf_cargo::SkeletonBuilder;
use std::env;
use std::path::PathBuf;

fn main() {
    let out_dir = env::var_os("OUT_DIR").unwrap();
    let out_path = PathBuf::from(out_dir);

    // Build eBPF programs
    SkeletonBuilder::new()
        .source("src/bpf/monitor.bpf.c")
        .build_and_generate(&out_path.join("monitor.skel.rs"))
        .unwrap();

    println!("cargo:rerun-if-changed=src/bpf/monitor.bpf.c");
}