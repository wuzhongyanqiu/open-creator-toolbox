use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Serialize)]
struct ToolStatus {
    id: &'static str,
    installed: bool,
}

struct DesktopTool {
    id: &'static str,
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    mac_apps: &'static [&'static str],
    commands: &'static [&'static str],
    #[cfg_attr(not(target_os = "windows"), allow(dead_code))]
    windows_paths: &'static [&'static str],
}

const TOOLS: &[DesktopTool] = &[
    DesktopTool {
        id: "xcode",
        mac_apps: &["Xcode.app"],
        commands: &[],
        windows_paths: &[],
    },
    DesktopTool {
        id: "android-studio",
        mac_apps: &["Android Studio.app"],
        commands: &["studio", "android-studio"],
        windows_paths: &[r"Android\Android Studio\bin\studio64.exe"],
    },
    DesktopTool {
        id: "gimp",
        mac_apps: &["GIMP.app", "GIMP-3.0.app"],
        commands: &["gimp", "gimp-3.0"],
        windows_paths: &[r"GIMP 3\bin\gimp-3.0.exe", r"GIMP 2\bin\gimp-2.10.exe"],
    },
    DesktopTool {
        id: "krita",
        mac_apps: &["Krita.app"],
        commands: &["krita"],
        windows_paths: &[r"Krita (x64)\bin\krita.exe", r"Krita\bin\krita.exe"],
    },
    DesktopTool {
        id: "darktable",
        mac_apps: &["darktable.app"],
        commands: &["darktable"],
        windows_paths: &[r"darktable\bin\darktable.exe"],
    },
    DesktopTool {
        id: "inkscape",
        mac_apps: &["Inkscape.app"],
        commands: &["inkscape"],
        windows_paths: &[r"Inkscape\bin\inkscape.exe"],
    },
    DesktopTool {
        id: "scribus",
        mac_apps: &["Scribus.app"],
        commands: &["scribus"],
        windows_paths: &[r"Scribus 1.6.0\Scribus.exe", r"Scribus\Scribus.exe"],
    },
    DesktopTool {
        id: "kdenlive",
        mac_apps: &["kdenlive.app", "Kdenlive.app"],
        commands: &["kdenlive"],
        windows_paths: &[r"kdenlive\bin\kdenlive.exe"],
    },
    DesktopTool {
        id: "blender",
        mac_apps: &["Blender.app"],
        commands: &["blender"],
        windows_paths: &[
            r"Blender Foundation\Blender 4.5\blender.exe",
            r"Blender Foundation\Blender\blender.exe",
        ],
    },
    DesktopTool {
        id: "natron",
        mac_apps: &["Natron.app"],
        commands: &["Natron", "natron"],
        windows_paths: &[
            r"INRIA\Natron-2.5.0\bin\Natron.exe",
            r"Natron\bin\Natron.exe",
        ],
    },
    DesktopTool {
        id: "audacity",
        mac_apps: &["Audacity.app"],
        commands: &["audacity"],
        windows_paths: &[r"Audacity\Audacity.exe"],
    },
    DesktopTool {
        id: "ardour",
        mac_apps: &["Ardour8.app", "Ardour7.app", "Ardour.app"],
        commands: &["ardour8", "ardour7", "ardour"],
        windows_paths: &[r"Ardour8\bin\ardour8.exe", r"Ardour7\bin\ardour7.exe"],
    },
    DesktopTool {
        id: "pixelorama",
        mac_apps: &["Pixelorama.app"],
        commands: &["pixelorama", "Pixelorama"],
        windows_paths: &[r"Pixelorama\Pixelorama.exe", r"Pixelorama.exe"],
    },
    DesktopTool {
        id: "libresprite",
        mac_apps: &["LibreSprite.app"],
        commands: &["libresprite", "LibreSprite"],
        windows_paths: &[r"LibreSprite\LibreSprite.exe"],
    },
    DesktopTool {
        id: "godot",
        mac_apps: &["Godot.app"],
        commands: &["godot", "godot4"],
        windows_paths: &[r"Godot\Godot.exe", r"Godot\Godot_v4.exe"],
    },
    DesktopTool {
        id: "makehuman",
        mac_apps: &["MakeHuman.app"],
        commands: &["makehuman"],
        windows_paths: &[r"MakeHuman\makehuman.exe"],
    },
    DesktopTool {
        id: "opentoonz",
        mac_apps: &["OpenToonz.app"],
        commands: &["opentoonz", "OpenToonz"],
        windows_paths: &[r"OpenToonz\OpenToonz.exe"],
    },
    DesktopTool {
        id: "obs",
        mac_apps: &["OBS.app"],
        commands: &["obs", "obs-studio"],
        windows_paths: &[r"obs-studio\bin\64bit\obs64.exe"],
    },
    DesktopTool {
        id: "lmms",
        mac_apps: &["LMMS.app"],
        commands: &["lmms"],
        windows_paths: &[r"LMMS\lmms.exe"],
    },
    DesktopTool {
        id: "musescore",
        mac_apps: &["MuseScore 4.app", "MuseScore Studio 4.app"],
        commands: &["mscore", "musescore", "musescore4"],
        windows_paths: &[
            r"MuseScore 4\bin\MuseScore4.exe",
            r"MuseScore Studio 4\bin\MuseScore4.exe",
        ],
    },
    DesktopTool {
        id: "rhubarb",
        mac_apps: &[],
        commands: &["rhubarb"],
        windows_paths: &[r"Rhubarb-Lip-Sync\rhubarb.exe"],
    },
    DesktopTool {
        id: "inky",
        mac_apps: &["Inky.app"],
        commands: &["inky"],
        windows_paths: &[r"Inky\Inky.exe"],
    },
    DesktopTool {
        id: "vale",
        mac_apps: &[],
        commands: &["vale"],
        windows_paths: &[r"Vale\vale.exe"],
    },
    DesktopTool {
        id: "comfyui",
        mac_apps: &["ComfyUI.app"],
        commands: &["comfy", "comfyui"],
        windows_paths: &[r"ComfyUI\ComfyUI.exe"],
    },
    DesktopTool {
        id: "invoke",
        mac_apps: &["Invoke.app"],
        commands: &["invokeai-web", "invokeai"],
        windows_paths: &[r"Invoke\Invoke.exe"],
    },
];

fn mac_app_path(names: &[&str]) -> Option<PathBuf> {
    let roots = [
        Path::new("/Applications"),
        Path::new("/System/Applications"),
    ];
    roots
        .iter()
        .flat_map(|root| names.iter().map(move |name| root.join(name)))
        .find(|path| path.exists())
}

fn command_path(names: &[&str]) -> Option<PathBuf> {
    let path_value = std::env::var_os("PATH")?;
    for directory in std::env::split_paths(&path_value) {
        for name in names {
            let candidate = directory.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn windows_path(paths: &[&str]) -> Option<PathBuf> {
    [
        std::env::var_os("ProgramFiles"),
        std::env::var_os("ProgramFiles(x86)"),
    ]
    .into_iter()
    .flatten()
    .map(PathBuf::from)
    .flat_map(|root| paths.iter().map(move |path| root.join(path)))
    .find(|path| path.is_file())
}

fn locate_tool(tool: &DesktopTool) -> Option<PathBuf> {
    #[cfg(target_os = "macos")]
    if let Some(path) = mac_app_path(tool.mac_apps) {
        return Some(path);
    }
    #[cfg(target_os = "windows")]
    if let Some(path) = windows_path(tool.windows_paths) {
        return Some(path);
    }
    command_path(tool.commands)
}

#[tauri::command]
fn detect_apps() -> Vec<ToolStatus> {
    TOOLS
        .iter()
        .map(|tool| ToolStatus {
            id: tool.id,
            installed: locate_tool(tool).is_some(),
        })
        .collect()
}

#[tauri::command]
fn launch_app(id: String) -> Result<(), String> {
    let tool = TOOLS
        .iter()
        .find(|tool| tool.id == id)
        .ok_or_else(|| "未知工具".to_string())?;
    let path =
        locate_tool(tool).ok_or_else(|| "未找到该应用，请重新扫描或先完成安装".to_string())?;
    #[cfg(target_os = "macos")]
    let result = if path.extension().is_some_and(|extension| extension == "app") {
        Command::new("open").arg(path).spawn()
    } else {
        Command::new(path).spawn()
    };
    #[cfg(not(target_os = "macos"))]
    let result = Command::new(path).spawn();
    result
        .map(|_| ())
        .map_err(|error| format!("启动失败：{error}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![detect_apps, launch_app])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tool_ids_are_unique() {
        let mut ids: Vec<_> = TOOLS.iter().map(|tool| tool.id).collect();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), TOOLS.len());
    }
}
