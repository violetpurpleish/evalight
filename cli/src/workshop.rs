use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result, ensure};
use flate2::read::GzDecoder;
use sha2::{Digest, Sha256};

const ARCHIVE: &[u8] = include_bytes!("../assets/workshop.tar.gz");
const SERVER: &str = "server.mjs";
const UI: &str = "public/js/main.js";

pub fn server_path() -> Result<PathBuf> {
    if let Some(path) = env::var_os("EVALIGHT_WORKSHOP_DIR") {
        let workshop = PathBuf::from(path);
        ensure!(
            is_workshop(&workshop),
            "workshop files missing in {} (EVALIGHT_WORKSHOP_DIR)",
            workshop.display()
        );
        return Ok(workshop.join(SERVER));
    }

    let adjacent = env::current_exe()?.with_file_name("evalight-workshop");
    if is_workshop(&adjacent) {
        return Ok(adjacent.join(SERVER));
    }

    Ok(cached_workshop(&cache_root()?.join("evalight"))?.join(SERVER))
}

fn cache_root() -> Result<PathBuf> {
    if let Some(cache) = env::var_os("XDG_CACHE_HOME")
        .map(PathBuf::from)
        .filter(|path| path.is_absolute())
    {
        return Ok(cache);
    }

    let home = env::home_dir().context("find the home directory for the Evalight cache")?;
    Ok(home.join(if cfg!(target_os = "macos") {
        "Library/Caches"
    } else {
        ".cache"
    }))
}

fn is_workshop(path: &Path) -> bool {
    path.join(SERVER).is_file() && path.join(UI).is_file()
}

fn cached_workshop(cache: &Path) -> Result<PathBuf> {
    let hash = Sha256::digest(ARCHIVE);
    let path = cache.join(format!("workshop-{hash:x}"));
    if is_workshop(&path) {
        return Ok(path);
    }

    fs::create_dir_all(cache).with_context(|| format!("create cache {}", cache.display()))?;
    let staging = tempfile::tempdir_in(cache).context("create workshop staging directory")?;
    tar::Archive::new(GzDecoder::new(ARCHIVE))
        .unpack(staging.path())
        .context("extract embedded Evalight workshop")?;
    ensure!(
        is_workshop(staging.path()),
        "embedded workshop is missing its server or UI"
    );

    // Readers only see the completed tree. A concurrent invocation may win the rename.
    match fs::rename(staging.path(), &path) {
        Ok(()) => Ok(path),
        Err(_) if is_workshop(&path) => Ok(path),
        Err(error) => Err(error).with_context(|| format!("install workshop in {}", path.display())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn concurrent_extraction_uses_one_complete_cache_entry() {
        let cache = tempfile::tempdir().unwrap();
        let path = std::thread::scope(|scope| {
            let first = scope.spawn(|| cached_workshop(cache.path()).unwrap());
            let second = cached_workshop(cache.path()).unwrap();
            assert_eq!(first.join().unwrap(), second);
            second
        });

        assert_eq!(cached_workshop(cache.path()).unwrap(), path);
        assert_eq!(fs::read_dir(cache.path()).unwrap().count(), 1);
        assert!(path.join("public/js/preview/preview.js").is_file());
    }
}
