/** Mirrors Rust `TrashEntry` (camelCase serde). */
export type TrashEntry = {
  trashName: string;
  originalPath: string;
  trashPath: string;
  deletedAtMs: number;
  size: number;
  isAttachment: boolean;
};
