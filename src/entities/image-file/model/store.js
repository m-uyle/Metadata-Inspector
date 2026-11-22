import { revokeItemUrls } from "./item-helpers.js";

export const state = {
  items: [],
  selectedId: null,
  checkedIds: new Set(),
  batchMode: false,
  editingTagUid: null,
  expandedTagUids: new Set(),
  activeThumbModalUrl: null,
  categoryFilter: "ALL",
  failed: [],
  previewRandToken: null,
};

const listeners = new Set();

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function notify(changedKeys = ["*"]) {
  const keys = changedKeys instanceof Set ? changedKeys : new Set(changedKeys);
  for (const listener of listeners) {
    listener(keys);
  }
}

export function setState(patch) {
  const keys = Object.keys(patch);
  if (!keys.length) {
    return;
  }
  Object.assign(state, patch);
  notify(keys);
}

export function resetState() {
  state.items.forEach(revokeItemUrls);
  state.items = [];
  state.failed = [];
  state.selectedId = null;
  state.checkedIds.clear();
  state.batchMode = false;
  state.editingTagUid = null;
  state.expandedTagUids.clear();
  state.activeThumbModalUrl = null;
  state.categoryFilter = "ALL";
  state.previewRandToken = null;
  notify(["*"]);
}

export function getActiveItem() {
  return state.items.find((i) => i.id === state.selectedId) || null;
}

export function getBatchItems() {
  if (state.checkedIds.size > 1) {
    return state.items.filter((i) => state.checkedIds.has(i.id));
  }
  return state.items;
}
