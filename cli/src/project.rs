use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{Context, Result, bail, ensure};

use crate::{Action, exec};

const GPUI_SHA: &str = include_str!("../templates/clj-gpui.rev");

struct TemplateFile {
    path: &'static str,
    bytes: &'static [u8],
}

macro_rules! template_file {
    ($dir:literal, $path:literal) => {
        template_file!($dir, $path => concat!("../templates/", $dir, "/", $path))
    };
    ($dir:literal, $path:literal => $source:expr) => {
        TemplateFile { path: $path, bytes: include_bytes!($source) }
    };
}

macro_rules! template {
    ($dir:literal, $($path:literal $(=> $source:expr)?),+ $(,)?) => {
        &[$(template_file!($dir, $path $(=> $source)?)),+]
    };
}

const GPUI_CLJ: &[TemplateFile] = template!(
    "clj",
    ".gitignore",
    "README.md",
    "deps.edn",
    "evalight.edn",
    "gpui.edn",
    "resources/icon.png",
    "src/my/app.clj",
    "test/my/app_test.clj",
    "test/my/test_runner.clj" => "../templates/test_runner.clj",
);

const GPUI_CLJS: &[TemplateFile] = template!(
    "cljs",
    ".gitignore",
    "README.md",
    "bun.lock",
    "deps.edn",
    "evalight.edn",
    "gpui.edn",
    "package.json",
    "shadow-cljs.edn",
    "resources/icon.png",
    "src/my/app.cljs",
    "src/my/host.clj",
    "test/my/app_test.cljs",
);

const CLJ: &[TemplateFile] = template!(
    "plain-clj",
    ".gitignore" => "../templates/clj/.gitignore",
    "README.md",
    "deps.edn",
    "evalight.edn",
    "src/my/app.clj",
    "test/my/app_test.clj",
    "test/my/test_runner.clj" => "../templates/test_runner.clj",
);

const BROWSER_CLJS: &[TemplateFile] = template!(
    "browser-cljs",
    ".gitignore",
    "README.md",
    "bun.lock",
    "evalight.edn",
    "package.json",
    "shadow-cljs.edn",
    "public/index.html",
    "test/app/gallery_test.cljs",
    // Use the same gallery, styles and UI sources as the website starter.
    "src/app/core.cljs" => "../../src/evalight/templates/core.cljs",
    "src/app/gallery.cljs" => "../../src/evalight/templates/gallery.cljs",
    "public/style.css" => "../../src/evalight/templates/style.css",
    "public/css/ui.css" => "../../public/css/ui.css",
    "src/ui/api.cljs" => "../../src/ui/api.cljs",
    "src/ui/breadcrumbs.cljs" => "../../src/ui/breadcrumbs.cljs",
    "src/ui/button.cljs" => "../../src/ui/button.cljs",
    "src/ui/checkbox.cljs" => "../../src/ui/checkbox.cljs",
    "src/ui/command.cljs" => "../../src/ui/command.cljs",
    "src/ui/core.cljs" => "../../src/ui/core.cljs",
    "src/ui/dialog.cljs" => "../../src/ui/dialog.cljs",
    "src/ui/disclosure.cljs" => "../../src/ui/disclosure.cljs",
    "src/ui/dropdown.cljs" => "../../src/ui/dropdown.cljs",
    "src/ui/field.cljs" => "../../src/ui/field.cljs",
    "src/ui/input.cljs" => "../../src/ui/input.cljs",
    "src/ui/popover.cljs" => "../../src/ui/popover.cljs",
    "src/ui/select.cljs" => "../../src/ui/select.cljs",
    "src/ui/split.cljs" => "../../src/ui/split.cljs",
    "src/ui/switch.cljs" => "../../src/ui/switch.cljs",
    "src/ui/tabs.cljs" => "../../src/ui/tabs.cljs",
    "src/ui/toast.cljs" => "../../src/ui/toast.cljs",
    "src/ui/tooltip.cljs" => "../../src/ui/tooltip.cljs",
    "src/ui/tree.cljs" => "../../src/ui/tree.cljs",
);

#[derive(Clone, Copy)]
pub enum Backend {
    Clj,
    Cljs,
}

impl Backend {
    pub fn from_cljs(cljs: bool) -> Self {
        if cljs { Self::Cljs } else { Self::Clj }
    }
}

pub fn create(parent: &Path, name: &str, gpui: bool, backend: Backend) -> Result<()> {
    ensure!(
        name.starts_with(|c: char| c.is_ascii_lowercase())
            && name
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
            && !name.ends_with('-')
            && !name.contains("--"),
        "use a lowercase project name starting with a letter, with letters, digits and single hyphens"
    );
    let root = parent.join(name);
    fs::create_dir(&root).with_context(|| format!("create {}", root.display()))?;
    let template = match (gpui, backend) {
        (false, Backend::Clj) => CLJ,
        (false, Backend::Cljs) => BROWSER_CLJS,
        (true, Backend::Clj) => GPUI_CLJ,
        (true, Backend::Cljs) => GPUI_CLJS,
    };
    if let Err(error) = write_project(&root, name, template) {
        if let Err(cleanup) = fs::remove_dir_all(&root) {
            eprintln!("could not remove {}: {cleanup}", root.display());
        }
        return Err(error).with_context(|| format!("write {}", root.display()));
    }
    Ok(())
}

fn write_project(root: &Path, name: &str, template: &[TemplateFile]) -> Result<()> {
    let namespace_path = name.replace('-', "_");
    let source_path = format!("src/{namespace_path}/");
    let namespace_dir = format!("/{namespace_path}/");
    let namespace_prefix = format!("{name}.");
    let git_dep = format!(
        ":git/url \"https://github.com/violetpurpleish/clj-gpui.git\" :git/sha \"{}\"",
        GPUI_SHA.trim()
    );
    for file in template {
        let path = root.join(file.path.replace("/my/", &namespace_dir));
        fs::create_dir_all(
            path.parent()
                .expect("template files are inside the project"),
        )?;
        if file.path.ends_with(".png") {
            fs::write(path, file.bytes)?;
        } else {
            let text = std::str::from_utf8(file.bytes)?
                .replace("my-app", name)
                .replace("My App", name)
                .replace("my.", &namespace_prefix)
                .replace("src/my/", &source_path)
                .replace(":local/root \"../clj-gpui\"", &git_dep);
            fs::write(path, text)?;
        }
    }

    fs::write(root.join("LICENSE"), include_bytes!("../../LICENSE"))?;
    Ok(())
}

pub fn find_root(cwd: &Path) -> Result<PathBuf> {
    // Stop at the closest project, even if it is nested inside a GPUI project.
    for directory in cwd.ancestors() {
        if [
            "gpui.edn",
            "evalight.edn",
            "deps.edn",
            "shadow-cljs.edn",
            "project.clj",
        ]
        .iter()
        .any(|name| directory.join(name).is_file())
        {
            return Ok(directory.to_owned());
        }
    }
    bail!(
        "no project found from {}. Run evalight new to create one",
        cwd.display()
    )
}

pub fn run(root: &Path, action: Action) -> Result<()> {
    let gpui = root.join("gpui.edn").is_file();
    if matches!(action, Action::Package) && !gpui {
        bail!("evalight package requires a native clj-gpui project with gpui.edn");
    }

    if root.join("shadow-cljs.edn").is_file() && root.join("package.json").is_file() {
        let script = match action {
            Action::Run if gpui => "start",
            Action::Run => "dev",
            Action::Test => "test",
            Action::Package => "package",
            _ => unreachable!(),
        };
        if !root
            .join("node_modules/shadow-cljs/cli/runner.js")
            .is_file()
        {
            let mut args = vec!["install"];
            if gpui || root.join("bun.lock").is_file() || root.join("bun.lockb").is_file() {
                args.push("--frozen-lockfile");
            }
            checked(root, "bun", &args)?;
        }
        if gpui && matches!(action, Action::Run) {
            checked(root, "bun", &["run", "compile"])?;
        }
        exec(Command::new("bun").args(["run", script]).current_dir(root))
    } else {
        ensure!(
            gpui || root.join("deps.edn").is_file(),
            "expected a deps.edn or a shadow-cljs project with package.json"
        );
        let alias = match action {
            Action::Run if gpui => "-M:dev",
            Action::Run => "-M:run",
            Action::Test => "-M:test",
            Action::Package => "-X:build",
            _ => unreachable!(),
        };
        let clojure = std::env::var_os("CLJ").unwrap_or_else(|| "clojure".into());
        exec(Command::new(clojure).arg(alias).current_dir(root))
    }
}

fn checked(root: &Path, program: &str, args: &[&str]) -> Result<()> {
    let status = Command::new(program)
        .args(args)
        .current_dir(root)
        .status()
        .with_context(|| format!("start {program} {}", args.join(" ")))?;
    ensure!(
        status.success(),
        "{program} {} failed ({status})",
        args.join(" ")
    );
    Ok(())
}
