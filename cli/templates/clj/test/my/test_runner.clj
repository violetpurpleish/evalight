(ns my.test-runner
  (:require [clojure.java.io :as io]
            [clojure.string :as str]
            [clojure.test :as test]))

(defn -main [& _]
  (let [root (.toPath (io/file "test"))
        test-nses (->> (file-seq (.toFile root))
                       (filter #(.isFile %))
                       (map #(str (.relativize root (.toPath %))))
                       (filter #(re-find #"_test\.cljc?$" %))
                       (map #(-> %
                                 (str/replace #"\.cljc?$" "")
                                 (str/replace "/" ".")
                                 (str/replace "_" "-")
                                 symbol))
                       sort)]
    (when (empty? test-nses)
      (throw (ex-info "No test namespaces found under test/" {})))
    (doseq [test-ns test-nses]
      (require test-ns))
    (let [{:keys [fail error]} (apply test/run-tests test-nses)]
      (when (pos? (+ fail error))
        (System/exit 1)))))
