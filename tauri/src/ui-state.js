import { invoke } from "@tauri-apps/api/core";

import { DEFAULT_ORDER, DEFAULT_WIDTHS, clampWidths } from "./table-model.js";

export async function loadUiState() {
  try {
    const state = await invoke("get_ui_state");
    if (state && Array.isArray(state.order) && state.widths) {
      return { order: state.order, widths: clampWidths(state.widths) };
    }
  } catch {
    // fall through to defaults
  }
  return { order: [...DEFAULT_ORDER], widths: { ...DEFAULT_WIDTHS } };
}

export async function saveUiState(order, widths) {
  try {
    await invoke("save_ui_state", { order, widths: clampWidths(widths) });
  } catch {
    // persistence is best-effort
  }
}
