(ns evalight.state)

(defonce app
  (atom {:mode :browser
         :fs-status :loading
         :fs-error nil
         :projects []
         :project nil
         :tree []
         :expanded #{"src" "public" "src/app"}
         :active-file nil
         :dirty #{}
         :repl {:ns "app.core"
                :entries []}
         :preview {:status :idle
                   :error nil
                   :live? true}
         :dialog nil
         :help? false
         :parinfer :smart
         :mobile-tab :editor
         :notice nil
         :layout {:files-open? true
                  :preview-open? true
                  :files-width 220
                  :preview-width 360
                  :dragging? false}}))

(defn get-state []
  @app)

(defn patch!
  ([f] (swap! app f))
  ([k v] (swap! app assoc k v)))

(defn notice! [text kind]
  (swap! app assoc :notice {:text text :kind (or kind :ok) :id (random-uuid)}))

(defn repl-entry [entry]
  (swap! app update-in [:repl :entries]
         (fn [xs]
           (let [next (conj (vec xs) (assoc entry :id (str (random-uuid))))]
             (vec (take-last 80 next))))))
