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

(defn file-plus []
  (svg {}
       [:path {:d "M6 3h6l4 4v4"}]
       [:path {:d "M12 3v4h4"}]
       [:path {:d "M6 3v18h7"}]
       [:path {:d "M17 14v7M13.5 17.5h7" :stroke-linecap "round"}]))

(defn folder []
  (svg {}
       [:path {:d "M4 7h6l2 2h8v10H4V7Z"}]))

(defn folder-plus []
  (svg {}
       [:path {:d "M3 19V5h6l2 3h10v11H3Z" :stroke-linejoin "round"}]
       [:path {:d "M12 11v5M9.5 13.5h5" :stroke-linecap "round"}]))

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

(defn pencil []
  (svg {}
       [:path {:d "M13.5 5.5 18 10l-9.2 9.2H4.3v-4.5L13.5 5.5Z" :stroke-linejoin "round"}]
       [:path {:d "m12 7 4.5 4.5" :stroke-linecap "round"}]))

(defn trash []
  (svg {}
       [:path {:d "M5 7h14" :stroke-linecap "round"}]
       [:path {:d "M10 7V5h4v2"}]
       [:path {:d "M8 7l.7 12h6.6L16 7"}]
       [:path {:d "M10 11v5M14 11v5" :stroke-linecap "round"}]))

(defn panel-left []
  (svg {}
       [:path {:d "M5 5h14v14H5V5Z"}]
       [:path {:d "M10 5v14"}]))

(defn panel-right []
  (svg {}
       [:path {:d "M5 5h14v14H5V5Z"}]
       [:path {:d "M14 5v14"}]))

(defn search []
  (svg {}
       [:circle {:cx 10.5 :cy 10.5 :r 6.5}]
       [:path {:d "m15.5 15.5 4.5 4.5" :stroke-linecap "round"}]))

(defn wrap []
  (svg {}
       [:path {:d "M4 6h16M4 11h11a3 3 0 1 1 0 6H9" :stroke-linecap "round"}]
       [:path {:d "m12 14-3 3 3 3" :stroke-linecap "round" :stroke-linejoin "round"}]
       [:path {:d "M4 20h2" :stroke-linecap "round"}]))

(defn undo []
  (svg {}
       [:path {:d "M3 7v6h6" :stroke-linecap "round" :stroke-linejoin "round"}]
       [:path {:d "M3.5 13A9 9 0 1 0 7 6.2" :stroke-linecap "round"}]))

(defn more []
  (svg {}
       [:circle {:cx 5 :cy 12 :r 1 :fill "currentColor"}]
       [:circle {:cx 12 :cy 12 :r 1 :fill "currentColor"}]
       [:circle {:cx 19 :cy 12 :r 1 :fill "currentColor"}]))

(defn components []
  (svg {}
       [:rect {:x 3 :y 3 :width 7 :height 7 :rx 1}]
       [:rect {:x 14 :y 3 :width 7 :height 7 :rx 1}]
       [:rect {:x 3 :y 14 :width 7 :height 7 :rx 1}]
       [:rect {:x 14 :y 14 :width 7 :height 7 :rx 1}]))
