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

macro_rules! template {
    ($backend:literal, $($path:literal),+ $(,)?) => {
        &[$(TemplateFile {
            path: $path,
            bytes: include_bytes!(concat!("../templates/", $backend, "/", $path)),
        }),+]
    };
}

const CLJ: &[TemplateFile] = template!(
    "clj",
    ".gitignore",
    "README.md",
    "deps.edn",
    "gpui.edn",
    "resources/icon.png",
    "src/my/app.clj",
    "test/my/app_test.clj",
    "test/my/test_runner.clj",
);

const CLJS: &[TemplateFile] = template!(
    "cljs",
    ".gitignore",
    "README.md",
    "bun.lock",
    "deps.edn",
    "gpui.edn",
    "package.json",
    "shadow-cljs.edn",
    "resources/icon.png",
    "src/my/app.cljs",
    "src/my/host.clj",
    "test/my/app_test.cljs",
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

pub fn create(parent: &Path, name: &str, backend: Backend) -> Result<()> {
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
    if let Err(error) = write_project(&root, name, backend) {
        if let Err(cleanup) = fs::remove_dir_all(&root) {
            eprintln!("could not remove {}: {cleanup}", root.display());
        }
        return Err(error).with_context(|| format!("write {}", root.display()));
    }
    Ok(())
}

fn write_project(root: &Path, name: &str, backend: Backend) -> Result<()> {
    let template = match backend {
        Backend::Clj => CLJ,
        Backend::Cljs => CLJS,
    };
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

    let main = match backend {
        Backend::Clj => format!("{name}.app/app"),
        Backend::Cljs => format!("{name}.app"),
    };
    fs::write(
        root.join("evalight.edn"),
        format!(
            "{{:name \"{name}\"\n :main {main}\n :runtime :gpui\n :preview {{:kind :native}}}}\n"
        ),
    )?;
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
    ensure!(
        root.join("gpui.edn").is_file(),
        "this command expects a clj-gpui project with gpui.edn"
    );
    // The CLJS starter includes a shadow build and Bun scripts.
    if root.join("shadow-cljs.edn").is_file() && root.join("package.json").is_file() {
        let script = match action {
            Action::Run => "start",
            Action::Test => "test",
            Action::Package => "package",
            _ => unreachable!(),
        };
        if !root
            .join("node_modules/shadow-cljs/cli/runner.js")
            .is_file()
        {
            checked(root, "bun", &["install", "--frozen-lockfile"])?;
        }
        if matches!(action, Action::Run) {
            checked(root, "bun", &["run", "compile"])?;
        }
        exec(Command::new("bun").args(["run", script]).current_dir(root))
    } else {
        let alias = match action {
            Action::Run => "-M:dev",
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
