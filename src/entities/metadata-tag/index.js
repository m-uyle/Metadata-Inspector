export {
  syncGpsLocFromRawSubTags,
  syncRawGpsSubTags,
} from "./model/gps-sync.js";
export {
  computeAutoTagMeta,
  GROUPS,
  groupOf,
  isEditableTag,
  isGpsRaw,
  isLockedTag,
  isProfileTag,
  NON_EDIT_IDS,
  sortForDisplay,
} from "./model/tag-taxonomy.js";
export { validateTagValue } from "./model/tag-validation.js";
