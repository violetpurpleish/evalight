# my-app

A native GPUI application in JVM Clojure. Edit `src/my/app.clj` to change the
window, or `gpui.edn` to customize the native package.

- `evalight run` launches the app with source reloading (`clojure -M:dev`).
- `evalight dev` launches the app and opens the local Evalight workshop.
- `evalight test` runs namespaces ending in `-test` under `test/` (`clojure -M:test`).
- `evalight package` builds a native package in `target/package/` (`clojure -X:build`).

Use the Clojure CLI, a JDK, and the Rust/native build prerequisites. Evalight's
workshop also needs Bun. Build on the OS and CPU architecture you intend to
ship. For platform-specific details, see the [clj-gpui JVM starter](https://github.com/violetpurpleish/clj-gpui/tree/main/templates/clj).
