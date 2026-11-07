# clj-gpui starters

The `clj/` and `cljs/` starters are based on the matching
[clj-gpui templates](https://github.com/violetpurpleish/clj-gpui/tree/ce172661bb68dc44ead8b1fb20212db938d87307/templates)
at the commit in `clj-gpui.rev`. They retain the upstream MIT license, which
Evalight writes to generated projects. Changes here add test entry points and
document the Evalight commands. At generation time the CLI rewrites the
project identity and uses the pinned Git dependency in place of the sibling
checkout. Keep the snapshots and pin in sync when updating them.
