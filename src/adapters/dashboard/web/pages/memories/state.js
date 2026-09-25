/* What the memories page is filtered to, shared by the legend (a band chip),
   the kind cards and the list's own filter bar. One listener: the list. */
export const filters = { state: "live", kind: null, band: null, offset: 0 };

const listeners = [];
export function onFilter(fn) { listeners.push(fn); }

/** Change some filters; any change other than the page offset starts at page one. */
export function setFilter(patch) {
  const pageOnly = Object.keys(patch).length === 1 && "offset" in patch;
  Object.assign(filters, patch);
  if (!pageOnly) filters.offset = 0;
  for (const fn of listeners) fn(filters);
}

/** A band or kind chip is a toggle: click it again to show everything. */
export function toggle(key, value) {
  setFilter({ [key]: filters[key] === value ? null : value });
}

/** Tell the page the store changed on purpose (a note, a removal). */
export function changed() { window.dispatchEvent(new CustomEvent("counterparts:changed")); }
