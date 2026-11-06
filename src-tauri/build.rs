fn main() {
    #[allow(unused_mut)]
    let mut attrs = tauri_build::Attributes::new();
    #[cfg(windows)]
    {
        attrs = attrs.windows_attributes(
            tauri_build::WindowsAttributes::new().link_resource_into_all_targets(true),
        );
    }
    tauri_build::try_build(attrs).expect("failed to run tauri-build");
}
