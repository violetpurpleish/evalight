(ns evalight.bytes
  "Binary file bodies. The FS protocol still returns strings for text;
  images and other binaries travel as {:encoding :base64 :mime :content}."
  (:require [evalight.paths :as paths]))

(defn packed?
  [x]
  (and (map? x)
       (= :base64 (:encoding x))
       (string? (:content x))))

(defn- u8->b64 [u8]
  (let [bytes (if (instance? js/Uint8Array u8) u8 (js/Uint8Array. u8))
        n (.-length bytes)]
    (loop [i 0 acc ""]
      (if (>= i n)
        (js/btoa acc)
        (let [end (js/Math.min n (+ i 0x8000))
              slice (.subarray bytes i end)]
          (recur end (str acc (.apply js/String.fromCharCode nil slice))))))))

(defn- b64->u8 [b64]
  (let [bin (js/atob (or b64 ""))
        n (.-length bin)
        out (js/Uint8Array. n)]
    (dotimes [i n]
      (aset out i (.charCodeAt bin i)))
    out))

(defn pack-u8
  [mime u8]
  {:encoding :base64
   :mime (or mime "application/octet-stream")
   :content (u8->b64 u8)})

(defn pack-b64
  [mime b64]
  {:encoding :base64
   :mime (or mime "application/octet-stream")
   :content (or b64 "")})

(defn unpack-u8
  [m]
  (b64->u8 (or (:content m) "")))

(defn data-url
  [m]
  (str "data:" (or (:mime m) "application/octet-stream")
       ";base64," (or (:content m) "")))

(defn pack-path
  "Wrap raw bytes for `path` using its mime type."
  [path u8]
  (pack-u8 (paths/mime path) u8))

(defn json-value
  "History / JSON form of a file body."
  [v]
  (if (packed? v)
    {"encoding" "base64"
     "mime" (or (:mime v) "application/octet-stream")
     "content" (or (:content v) "")}
    v))

(defn from-json-value
  [v]
  (let [m (when (map? v) v)
        enc (when m (or (get m "encoding") (:encoding m)))]
    (if (or (= enc "base64") (= enc :base64))
      (pack-b64 (or (get m "mime") (:mime m) "application/octet-stream")
                (or (get m "content") (:content m) ""))
      (str (or v "")))))
