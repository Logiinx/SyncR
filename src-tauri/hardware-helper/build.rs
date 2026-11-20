// The helper runs as admin, once from a user folder (the first set-up). Windows would look for the
// libraries it needs in the program's own folder first, where any program could put a fake one:
// this tells Windows to load them from System32 only.
fn main() {
  println!("cargo:rustc-link-arg-bins=/DEPENDENTLOADFLAG:0x800");
  // SyncR's icon, and the name Task Manager shows (its description), so it sits next to SyncR
  println!("cargo:rerun-if-changed=../icons/icon.ico");
  let mut resource = tauri_winres::WindowsResource::new();
  resource.set_icon("../icons/icon.ico").set("FileDescription", "SyncR Hardware").set("ProductName", "SyncR");
  resource.compile().expect("couldn't add the helper's icon");
}
