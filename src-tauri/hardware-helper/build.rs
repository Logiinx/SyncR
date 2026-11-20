// The helper runs as admin, once from a user folder (the first set-up). Windows would look for the
// libraries it needs in the program's own folder first, where any program could put a fake one:
// this tells Windows to load them from System32 only.
fn main() {
  println!("cargo:rustc-link-arg-bins=/DEPENDENTLOADFLAG:0x800");
}
