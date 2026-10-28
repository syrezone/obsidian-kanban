// Personal build: line-based three-way merge for a board changed on disk while it had
// unsaved edits (the policy Obsidian applies to its own text views). Where both sides
// changed the same base lines differently, ours wins; where both only inserted lines at
// the same place, both insertions are kept, ours first.

/** For each line of `a`, the index of its match in `b` along a longest common subsequence, or -1. */
function matchLines(a: string[], b: string[]): Int32Array {
  const match = new Int32Array(a.length).fill(-1);
  // Edits are usually local; trimming the common ends keeps the table small.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    match[start] = start;
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
    match[endA] = endB;
  }

  const rows = endA - start;
  const cols = endB - start;
  if (!rows || !cols) return match;

  // lengths[i][j]: LCS length of a[start + i..endA) and b[start + j..endB).
  const width = cols + 1;
  const lengths = new Int32Array((rows + 1) * width);
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      lengths[i * width + j] =
        a[start + i] === b[start + j]
          ? lengths[(i + 1) * width + j + 1] + 1
          : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
    }
  }
  for (let i = 0, j = 0; i < rows && j < cols; ) {
    if (a[start + i] === b[start + j]) {
      match[start + i] = start + j;
      i++;
      j++;
    } else if (lengths[(i + 1) * width + j] >= lengths[i * width + j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return match;
}

const sameLines = (a: string[], b: string[]) =>
  a.length === b.length && a.every((line, i) => line === b[i]);

function mergeChunk(base: string[], ours: string[], theirs: string[]): string[] {
  if (sameLines(ours, base)) return theirs;
  if (sameLines(theirs, base) || sameLines(ours, theirs)) return ours;
  // Both inserted at the same place: keep both. Both changed the same lines: ours wins.
  return base.length ? ours : [...ours, ...theirs];
}

export function merge3(base: string, ours: string, theirs: string): string {
  if (ours === theirs || theirs === base) return ours;
  if (ours === base) return theirs;

  const b = base.split('\n');
  const o = ours.split('\n');
  const t = theirs.split('\n');
  const toOurs = matchLines(b, o);
  const toTheirs = matchLines(b, t);

  // Base lines kept by both sides are stable anchors; merge the chunks between them.
  const merged: string[] = [];
  let bi = 0;
  let oi = 0;
  let ti = 0;
  for (;;) {
    let anchor = bi;
    while (anchor < b.length && (toOurs[anchor] < 0 || toTheirs[anchor] < 0)) anchor++;
    const oEnd = anchor < b.length ? toOurs[anchor] : o.length;
    const tEnd = anchor < b.length ? toTheirs[anchor] : t.length;
    merged.push(...mergeChunk(b.slice(bi, anchor), o.slice(oi, oEnd), t.slice(ti, tEnd)));
    if (anchor >= b.length) break;
    merged.push(b[anchor]);
    bi = anchor + 1;
    oi = oEnd + 1;
    ti = tEnd + 1;
  }
  return merged.join('\n');
}
