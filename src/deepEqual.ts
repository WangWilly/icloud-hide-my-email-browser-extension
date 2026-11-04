type PlainData =
  | null
  | undefined
  | boolean
  | number
  | string
  | PlainData[]
  | { [key: string]: PlainData };

/** Compares acyclic plain data by value without mutating either input. */
export function deepEqual(left: PlainData, right: PlainData): boolean {
  if (left === right || (Number.isNaN(left) && Number.isNaN(right))) {
    return true;
  }

  if (
    left === null ||
    right === null ||
    typeof left !== 'object' ||
    typeof right !== 'object'
  ) {
    return false;
  }

  if (Array.isArray(left)) {
    if (!Array.isArray(right) || left.length !== right.length) {
      return false;
    }

    for (let index = 0; index < left.length; index += 1) {
      if (!deepEqual(left[index], right[index])) {
        return false;
      }
    }
    return true;
  }

  if (Array.isArray(right)) {
    return false;
  }

  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) {
    return false;
  }

  for (const key of leftKeys) {
    if (
      !Object.prototype.hasOwnProperty.call(right, key) ||
      !deepEqual(left[key], right[key])
    ) {
      return false;
    }
  }
  return true;
}
