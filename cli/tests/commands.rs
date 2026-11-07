use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::Command;

use tempfile::tempdir;

fn evalight(cwd: &Path) -> Command {
    let mut cli = Command::new(env!("CARGO_BIN_EXE_evalight"));
    cli.current_dir(cwd);
    cli
}

#[test]
fn scaffolds_both_backends() {
    let parent = tempdir().unwrap();
    for (name, backend) in [("jvm-app", "clj"), ("script-app", "cljs")] {
        let mut command = evalight(parent.path());
        command.args(["new", name, "--gpui"]);
        if backend == "cljs" {
            command.arg("--cljs");
        }
        let output = command.output().unwrap();
        assert!(output.status.success(), "{:?}", output);
        let root = parent.path().join(name);
        let ns_path = name.replace('-', "_");
        let app = fs::read_to_string(root.join(format!("src/{ns_path}/app.{backend}"))).unwrap();
        assert!(app.contains(&format!("(ns {name}.app")));
        let setup = fs::read_to_string(root.join("evalight.edn")).unwrap();
        assert!(setup.contains(":runtime :gpui"));
        assert!(setup.contains(&format!(":main {name}.app")));
        let deps = fs::read_to_string(root.join("deps.edn")).unwrap();
        assert!(deps.contains(include_str!("../templates/clj-gpui.rev").trim()));
        assert!(!deps.contains(":local/root"));
        assert!(root.join("resources/icon.png").is_file());
        assert!(
            root.join(format!("test/{ns_path}/app_test.{backend}"))
                .is_file()
        );
        assert_eq!(root.join("bun.lock").is_file(), backend == "cljs");
        assert!(!root.join("evalight").exists());
    }
}

#[test]
fn rejects_paths_and_preserves_existing_projects() {
    let parent = tempdir().unwrap();
    let existing = parent.path().join("existing");
    fs::create_dir(&existing).unwrap();
    fs::write(existing.join("keep.txt"), "keep me").unwrap();

    for name in ["../escape", "existing"] {
        let output = evalight(parent.path())
            .args(["new", name])
            .output()
            .unwrap();
        assert!(!output.status.success());
    }
    assert_eq!(
        fs::read_to_string(existing.join("keep.txt")).unwrap(),
        "keep me"
    );
    assert!(!existing.join("evalight.edn").exists());
}

#[test]
fn delegates_to_project_commands_from_nested_directories() {
    let parent = tempdir().unwrap();
    let root = parent.path();
    let nested = root.join("src/app");
    fs::create_dir_all(&nested).unwrap();
    fs::write(root.join("gpui.edn"), "{}").unwrap();
    let runner = root.join("bun");
    fs::write(&runner, "#!/bin/sh\nprintf '%s\\n' \"$*\" >> commands\n").unwrap();
    fs::set_permissions(&runner, fs::Permissions::from_mode(0o755)).unwrap();

    for action in ["run", "test", "package"] {
        let status = evalight(&nested)
            .arg(action)
            .env("CLJ", &runner)
            .status()
            .unwrap();
        assert!(status.success());
    }
    assert_eq!(
        fs::read_to_string(root.join("commands")).unwrap(),
        "-M:dev\n-M:test\n-X:build\n"
    );

    fs::write(root.join("shadow-cljs.edn"), "{}").unwrap();
    fs::write(root.join("package.json"), "{}").unwrap();
    for action in ["run", "test", "package"] {
        let status = evalight(&nested)
            .arg(action)
            .env("PATH", root)
            .status()
            .unwrap();
        assert!(status.success());
    }
    assert_eq!(
        fs::read_to_string(root.join("commands")).unwrap(),
        concat!(
            "-M:dev\n-M:test\n-X:build\n",
            "install --frozen-lockfile\nrun compile\nrun start\n",
            "install --frozen-lockfile\nrun test\n",
            "install --frozen-lockfile\nrun package\n"
        )
    );
}
