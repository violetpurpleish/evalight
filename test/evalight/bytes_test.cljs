(ns evalight.bytes-test
  (:require [cljs.test :refer [deftest is] :include-macros true]
            [evalight.bytes :as bytes]))

(def png-b64
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")

(deftest pack-roundtrip-keeps-bytes
  (let [u8 (bytes/unpack-u8 (bytes/pack-b64 "image/png" png-b64))
        back (bytes/pack-u8 "image/png" u8)]
    (is (bytes/packed? back))
    (is (= png-b64 (:content back)))
    (is (= "image/png" (:mime back)))
    (is (re-find #"^data:image/png;base64,iVBOR" (bytes/data-url back)))))

(deftest json-roundtrip-keeps-payload
  (let [packed (bytes/pack-b64 "image/png" png-b64)
        out (bytes/from-json-value (bytes/json-value packed))]
    (is (bytes/packed? out))
    (is (= png-b64 (:content out)))
    (is (= "old text" (bytes/from-json-value "old text")))))
