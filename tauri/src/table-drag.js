import Sortable from "sortablejs";

import { MIN_WIDTHS, clampWidths } from "./table-model.js";

export function setupTaskTable(table, onChanged) {
  for (const th of table.querySelectorAll("th")) {
    if (!th.querySelector(".resize-handle")) {
      const handle = document.createElement("div");
      handle.className = "resize-handle";
      th.appendChild(handle);
    }
  }

  let dragging = null;
  table.addEventListener("mousedown", (e) => {
    const handle = e.target.closest(".resize-handle");
    if (!handle) return;
    const th = handle.closest("th");
    const next = th.nextElementSibling;
    if (!next) return;
    e.preventDefault();
    document.body.classList.add("resizing");
    dragging = {
      th,
      next,
      startX: e.clientX,
      startW: th.getBoundingClientRect().width,
      nextW: next.getBoundingClientRect().width,
    };
  });

  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - dragging.startX;
    const min = MIN_WIDTHS[dragging.th.dataset.col] || 80;
    const nextMin = MIN_WIDTHS[dragging.next.dataset.col] || 80;
    let w = Math.max(min, dragging.startW + dx);
    let nw = dragging.nextW - (w - dragging.startW);
    if (nw < nextMin) {
      w -= nextMin - nw;
      nw = nextMin;
    }
    dragging.th.style.width = `${Math.max(min, w)}px`;
    dragging.next.style.width = `${nw}px`;
  });

  document.addEventListener("mouseup", () => {
    if (!dragging) return;
    document.body.classList.remove("resizing");
    onChanged?.(null, collectWidths(table));
    dragging = null;
  });

  Sortable.create(table.tHead.rows[0], {
    animation: 150,
    forceFallback: true,
    fallbackOnBody: true,
    ghostClass: "sortable-ghost",
    onEnd: () => {
      const order = Array.from(table.tHead.rows[0].cells).map(
        (th) => th.dataset.col
      );
      onChanged?.(order, collectWidths(table));
    },
  });
}

export function collectWidths(table) {
  const widths = {};
  for (const th of table.querySelectorAll("th")) {
    widths[th.dataset.col] = Math.round(th.getBoundingClientRect().width);
  }
  return clampWidths(widths);
}
