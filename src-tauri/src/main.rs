// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // `zastava --cleanup`: remove every proxy setting Zastava may have left in the OS
    // (PAC, PowerShell profiles, legacy HKCU\Environment values, Claude / IDE settings)
    // and exit without starting the UI. Invoked by the NSIS uninstaller, also handy
    // after the app was killed.
    if std::env::args().skip(1).any(|a| a == "--cleanup") {
        zastava_lib::sysproxy::cleanup_all_persistent_settings();
        return;
    }
    zastava_lib::run()
}
