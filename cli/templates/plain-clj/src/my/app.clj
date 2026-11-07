(ns my.app)

(defn greet [name]
  (str "Hello, " name "!"))

(defn -main [& [name]]
  (println (greet (or name "world"))))
