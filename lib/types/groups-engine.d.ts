export type ChangeRow<T> =
  | {new_val: T, old_val: null}
  | {new_val: null, old_val: T}
  | {new_val: T, old_val: T}
