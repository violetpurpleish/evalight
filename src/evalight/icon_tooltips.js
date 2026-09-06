// One tooltip host keeps labels out of clipped sidebars and scrolling panes.
export function installIconTooltips(root) {
  const tip = document.createElement("div");
  tip.id = "workshop-icon-tooltip";
  tip.className = "icon-tooltip";
  tip.setAttribute("role", "tooltip");
  tip.setAttribute("popover", "manual");
  document.body.appendChild(tip);
  let active = null;
  let timer = null;
  let title = "";
  let describedBy = null;

  function hide() {
    clearTimeout(timer);
    timer = null;
    tip.hidePopover();
    if (active) {
      active.title = title;
      if (describedBy === null) active.removeAttribute("aria-describedby");
      else active.setAttribute("aria-describedby", describedBy);
    }
    active = null;
  }

  function buttonFor(target) {
    const button = target.closest?.("button");
    if (!button || !root.contains(button) || !button.querySelector("svg")) return null;
    // A history count is a badge, not a button label.
    const copy = button.cloneNode(true);
    copy.querySelectorAll("svg, .history-count").forEach(node => node.remove());
    return copy.textContent.trim() ? null : button;
  }

  function show(button, delay) {
    if (!button || button === active) return;
    hide();
    if (!button.title) return;
    active = button;
    title = button.title;
    describedBy = button.getAttribute("aria-describedby");
    button.removeAttribute("title"); // Avoid a second, native tooltip.
    timer = setTimeout(() => {
      if (!button.isConnected) return hide();
      tip.textContent = title;
      tip.showPopover();
      const box = button.getBoundingClientRect();
      const size = tip.getBoundingClientRect();
      tip.style.left = Math.max(8, Math.min(
        box.left + (box.width - size.width) / 2, innerWidth - size.width - 8
      )) + "px";
      tip.style.top = (box.bottom + size.height + 8 <= innerHeight
        ? box.bottom + 7 : Math.max(8, box.top - size.height - 7)) + "px";
      button.setAttribute("aria-describedby",
        [describedBy, tip.id].filter(Boolean).join(" "));
    }, delay);
  }

  const over = e => { if (e.pointerType !== "touch") show(buttonFor(e.target), 300); };
  const out = e => { if (active && !active.contains(e.relatedTarget)) hide(); };
  const focus = e => show(buttonFor(e.target), 0);
  const key = e => { if (e.key === "Escape") hide(); };
  root.addEventListener("pointerover", over);
  root.addEventListener("pointerout", out);
  root.addEventListener("focusin", focus);
  root.addEventListener("focusout", out);
  root.addEventListener("pointerdown", hide);
  document.addEventListener("keydown", key);
  document.addEventListener("scroll", hide, true);
  window.addEventListener("resize", hide);
  return () => {
    hide();
    root.removeEventListener("pointerover", over);
    root.removeEventListener("pointerout", out);
    root.removeEventListener("focusin", focus);
    root.removeEventListener("focusout", out);
    root.removeEventListener("pointerdown", hide);
    document.removeEventListener("keydown", key);
    document.removeEventListener("scroll", hide, true);
    window.removeEventListener("resize", hide);
    tip.remove();
  };
}
