# my-app

A native GPUI application in ClojureScript. Edit `src/my/app.cljs` to change
the window, or `gpui.edn` to customize the native package.

- `evalight run` installs dependencies as needed, compiles, and starts the app.
- `evalight dev` starts the app with hot reload and opens the local Evalight workshop.
- `evalight test` compiles and runs namespaces ending in `-test` under `test/` (`bun run test`).
- `evalight package` builds a native package in `target/package/` (`bun run package`).

Use Bun, a JDK, the Clojure CLI, and the Rust/native build prerequisites.
Build on the OS and CPU architecture you intend to ship. For platform-specific
details, see the [clj-gpui ClojureScript starter](https://github.com/violetpurpleish/clj-gpui/tree/main/templates/cljs).
