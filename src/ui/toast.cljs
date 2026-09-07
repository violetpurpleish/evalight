(ns ui.toast
  (:require [ui.core :as ui]))

(defn- timer-attrs [duration]
  {:replicant/on-mount
   (fn [{:keys [replicant/node]}]
     (let [remaining (atom duration)
           started (atom 0)
           timer (atom nil)
           paused (atom #{})
           start (fn []
                   (when (and (pos? duration) (empty? @paused))
                     (reset! started (.now js/Date))
                     (reset! timer
                             (js/setTimeout
                              #(some-> (.querySelector node ".ui-toast-dismiss-event") .click)
                              @remaining))))
           pause (fn [reason]
                   (when (empty? @paused)
                     (js/clearTimeout @timer)
                     (swap! remaining #(max 0 (- % (- (.now js/Date) @started)))))
                   (swap! paused conj reason))
           resume (fn [reason]
                    (swap! paused disj reason)
                    (when (empty? @paused) (start)))
           enter (fn [_] (pause :pointer))
           leave (fn [_] (resume :pointer))
           focus (fn [_] (pause :focus))
           blur (fn [e] (when-not (.contains node (.-relatedTarget e)) (resume :focus)))]
       (start)
       (.addEventListener node "mouseenter" enter)
       (.addEventListener node "mouseleave" leave)
       (.addEventListener node "focusin" focus)
       (.addEventListener node "focusout" blur)
       (aset node "__uiToastCleanup"
             (fn []
               (js/clearTimeout @timer)
               (.removeEventListener node "mouseenter" enter)
               (.removeEventListener node "mouseleave" leave)
               (.removeEventListener node "focusin" focus)
               (.removeEventListener node "focusout" blur)))))
   :replicant/on-unmount
   (fn [{:keys [replicant/node]}]
     (when-let [cleanup (aget node "__uiToastCleanup")] (cleanup)))})

(defn toast
  "One notice. :id identifies its lifetime; change it for a new message.
  :text, :kind (:error or :success), :duration (ms, default 5000; 0 persists),
  :on-dismiss and optional :action {:label :on-click}. Auto-dismiss pauses
  while hovered or focused. Parent removes the toast on dismissal."
  [{:keys [id text kind on-dismiss action duration] :or {duration 5000} :as props}]
  [:div
   (merge (ui/attrs {:class ["ui-toast" (when (= kind :error) "is-error")]
                    :replicant/key id}
                   props [:id :text :kind :duration :on-dismiss :action])
          (timer-attrs (if on-dismiss duration 0)))
   [:span.ui-toast-message {:role (if (= kind :error) "alert" "status")
                            :aria-atomic true}
    text]
   (when action
     [:button.ui-toast-action
      {:type "button" :on {:click (ui/wrapped (fn [e]
                                   (ui/run e (:on-click action))
                                   (ui/run e on-dismiss)))}}
      (:label action)])
   (when on-dismiss
     [:button.ui-toast-close
      {:type "button" :aria-label "Dismiss notification" :title "Dismiss notification"
       :on {:click on-dismiss}}
      [:svg {:viewBox "0 0 16 16" :width 14 :height 14 :aria-hidden true}
       [:path {:d "m4 4 8 8M12 4l-8 8" :fill "none" :stroke "currentColor" :stroke-width 1.5}]]])
   [:button.ui-toast-dismiss-event {:type "button" :hidden true :on {:click on-dismiss}}]])
