(ns evalight.icons)

(defn svg [attrs & body]
  (into [:svg (merge {:xmlns "http://www.w3.org/2000/svg"
                        :fill "none"
                        :viewBox "0 0 24 24"
                        :stroke "currentColor"
                        :stroke-width "1.6"
                        :aria-hidden "true"}
                     attrs)]
        body))

(defn lamp []
  (svg {:class "icon-lamp" :viewBox "0 0 24 24"}
       [:path {:d "M8 18h8M9 21h6" :stroke-linecap "round"}]
       [:path {:d "M7 10.5c0-2.8 2.2-5 5-5s5 2.2 5 5c0 1.6-.7 2.6-1.6 3.8-.6.8-1.4 1.7-1.4 2.7H10c0-1-.8-1.9-1.4-2.7C7.7 13.1 7 12.1 7 10.5Z"}]
       [:path {:d "M12 5.5V4" :stroke-linecap "round"}]))

(defn file []
  (svg {}
       [:path {:d "M8 4h6l4 4v12H8V4Z"}]
       [:path {:d "M14 4v4h4"}]))

(defn folder []
  (svg {}
       [:path {:d "M4 7h6l2 2h8v10H4V7Z"}]))

(defn plus []
  (svg {}
       [:path {:d "M12 6v12M6 12h12" :stroke-linecap "round"}]))

(defn download []
  (svg {}
       [:path {:d "M12 5v10M8 11l4 4 4-4" :stroke-linecap "round" :stroke-linejoin "round"}]
       [:path {:d "M6 19h12" :stroke-linecap "round"}]))

(defn play []
  (svg {}
       [:path {:d "M8 6.5v11L18 12 8 6.5Z" :fill "currentColor" :stroke "none"}]))

(defn help []
  (svg {}
       [:circle {:cx "12" :cy "12" :r "8.5"}]
       [:path {:d "M9.5 10a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1.4.9-1.4 1.7M12 17h.01" :stroke-linecap "round"}]))

(defn close []
  (svg {}
       [:path {:d "M7 7l10 10M17 7 7 17" :stroke-linecap "round"}]))
