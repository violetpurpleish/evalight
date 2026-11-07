mod project;

use std::env;
use std::io::{self, IsTerminal, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode};

use anyhow::{Context, Result, bail};
use clap::{Parser, Subcommand};
use project::Backend;

#[derive(Parser)]
#[command(version, about)]
struct Cli {
    #[command(subcommand)]
    command: Option<Action>,
}

#[derive(Subcommand)]
enum Action {
    /// Create a new project
    New {
        /// Project directory name
        name: Option<String>,
        /// Use a native clj-gpui starter
        #[arg(long)]
        gpui: bool,
        /// Use ClojureScript instead of JVM Clojure
        #[arg(long)]
        cljs: bool,
    },
    /// Run the application
    Run,
    /// Start the local Evalight workshop
    Dev {
        /// Attach to an already running application
        #[arg(long)]
        attach: bool,
        /// Print the workshop URL without opening the browser
        #[arg(long)]
        no_open: bool,
    },
    /// Run the project's tests
    Test,
    /// Build a native application package
    Package,
}

fn main() -> ExitCode {
    match run(Cli::parse().command) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("error: {error:#}");
            ExitCode::FAILURE
        }
    }
}

fn run(action: Option<Action>) -> Result<()> {
    let cwd = env::current_dir().context("find the current directory")?;
    match action {
        None => new_project(&cwd, None, false, false),
        Some(Action::New { name, gpui, cljs }) => new_project(&cwd, name, gpui, cljs),
        Some(Action::Dev { attach, no_open }) => dev(&project::find_root(&cwd)?, attach, no_open),
        Some(action) => project::run(&project::find_root(&cwd)?, action),
    }
}

fn new_project(cwd: &Path, name: Option<String>, gpui: bool, cljs: bool) -> Result<()> {
    let (name, gpui, cljs) = match name {
        Some(name) => (name, gpui, cljs),
        None => {
            if !io::stdin().is_terminal() {
                bail!("provide a project name, for example: evalight new myproject");
            }
            let name = prompt("Project name: ")?;
            let gpui = gpui || choose_second("Project type", "Standard", "Native GPUI")?;
            let cljs = cljs || choose_second("Language", "Clojure", "ClojureScript")?;
            (name, gpui, cljs)
        }
    };

    project::create(cwd, &name, gpui, Backend::from_cljs(cljs))?;
    println!("Created {name}/. Run `cd {name}` and then `evalight dev`.");
    Ok(())
}

fn choose_second(label: &str, first: &str, second: &str) -> Result<bool> {
    loop {
        match prompt(&format!("{label} [1] {first} (default), [2] {second}: "))?.as_str() {
            "" | "1" => return Ok(false),
            "2" => return Ok(true),
            _ => eprintln!("Choose 1 for {first} or 2 for {second}."),
        }
    }
}

fn prompt(label: &str) -> Result<String> {
    eprint!("{label}");
    io::stderr().flush()?;
    let mut answer = String::new();
    if io::stdin().read_line(&mut answer)? == 0 {
        bail!("project creation cancelled");
    }
    Ok(answer.trim().to_owned())
}

fn dev(root: &Path, attach: bool, no_open: bool) -> Result<()> {
    let workshop = match env::var_os("EVALIGHT_WORKSHOP_DIR") {
        Some(path) => PathBuf::from(path),
        None => env::current_exe()?.with_file_name("evalight-workshop"),
    };
    let server = workshop.join("server.mjs");
    if !server.is_file() || !workshop.join("public/js/main.js").is_file() {
        bail!(
            "workshop files missing in {}. Install the full CLI archive or set EVALIGHT_WORKSHOP_DIR to a built workshop",
            workshop.display()
        );
    }
    let server = server
        .canonicalize()
        .context("resolve the workshop server")?;
    let mut command = Command::new("bun");
    command
        .arg(server)
        .arg(root)
        .current_dir(root)
        .env_remove("EVALIGHT_OPEN_BROWSER");
    if attach {
        command.arg("--attach");
    }
    if !no_open {
        command.env("EVALIGHT_OPEN_BROWSER", "1");
    }
    exec(&mut command)
}

fn exec(command: &mut Command) -> Result<()> {
    use std::os::unix::process::CommandExt;
    Err(command.exec()).with_context(|| format!("start {command:?}"))
}
