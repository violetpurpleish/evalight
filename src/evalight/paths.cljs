(ns evalight.paths
  (:require [clojure.string :as str]))

(defn split [path]
  (->> (str/split (or path "") #"/")
       (remove str/blank?)
       vec))

(defn join [& parts]
  (->> parts
       (mapcat (fn [p]
                 (cond
                   (nil? p) []
                   (sequential? p) (mapcat split p)
                   :else (split p))))
       (str/join "/")))

(defn normalize [path]
  (let [parts (split path)
        out (reduce (fn [acc p]
                      (cond
                        (= p ".") acc
                        (= p "..") (if (seq acc) (pop acc) acc)
                        :else (conj acc p)))
                    []
                    parts)]
    (str/join "/" out)))

(defn basename [path]
  (or (last (split path)) ""))

(defn dirname [path]
  (let [parts (split path)]
    (str/join "/" (butlast parts))))

(defn ext [path]
  (let [name (basename path)
        i (str/last-index-of name ".")]
    (if (and i (pos? i))
      (str/lower-case (subs name (inc i)))
      "")))

(defn clojure-file? [path]
  (contains? #{"clj" "cljs" "cljc" "edn"} (ext path)))

(def image-exts
  "Raster images the workshop shows as pictures, not as text."
  #{"png" "jpg" "jpeg" "gif" "webp" "ico" "bmp" "avif"})

(def binary-exts
  "Keep in sync with isBinaryPath in src/evalight/embed/fs-http.mjs."
  (into image-exts
        #{"woff" "woff2" "ttf" "otf" "eot"
          "wasm" "zip" "gz" "tgz" "7z" "rar" "bin"
          "pdf" "mp3" "mp4" "webm" "ogg" "wav" "mov"
          "class" "jar"}))

(def mime-by-ext
  {"png" "image/png"
   "jpg" "image/jpeg"
   "jpeg" "image/jpeg"
   "gif" "image/gif"
   "webp" "image/webp"
   "ico" "image/x-icon"
   "bmp" "image/bmp"
   "avif" "image/avif"
   "woff" "font/woff"
   "woff2" "font/woff2"
   "ttf" "font/ttf"
   "otf" "font/otf"
   "eot" "application/vnd.ms-fontobject"
   "wasm" "application/wasm"
   "zip" "application/zip"
   "gz" "application/gzip"
   "pdf" "application/pdf"
   "mp3" "audio/mpeg"
   "mp4" "video/mp4"
   "webm" "video/webm"
   "ogg" "audio/ogg"
   "wav" "audio/wav"
   "jar" "application/java-archive"})

(defn image-file? [path]
  (contains? image-exts (ext path)))

(defn binary-file? [path]
  (contains? binary-exts (ext path)))

(defn mime [path]
  (get mime-by-ext (ext path) "application/octet-stream"))

(defn parent-segments [path]
  (let [parts (split path)]
    (mapv #(str/join "/" (subvec parts 0 %))
          (range 1 (count parts)))))

(defn starts-with-path? [path prefix]
  (or (= path prefix)
      (str/starts-with? (str path "/") (str prefix "/"))))

(defn remap-under
  "Rewrite `path` after `from` was renamed to `to`."
  [path from to]
  (cond
    (= path from) to
    (starts-with-path? path from) (join to (subs path (inc (count from))))
    :else path))

(defn slug [s]
  (-> (or s "")
      str/lower-case
      (str/replace #"[^a-z0-9]+" "-")
      (str/replace #"^-+|-+$" "")))
