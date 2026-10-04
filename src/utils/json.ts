// Small JSON helpers shared across the server.

/** How deep a JSON value nests, counted without recursion (so no value can overflow the stack). Stops counting past the limit. */
export function depthOf(v: unknown, limit = 1000): number {
  let max = 0
  const stack: [unknown, number][] = [[v, 1]]
  while (stack.length) {
    const [x, d] = stack.pop()!
    if (!x || typeof x !== 'object') continue
    if (d > max) max = d
    if (max > limit) return max
    for (const c of Array.isArray(x) ? x : Object.values(x)) if (c && typeof c === 'object') stack.push([c, d + 1])
  }
  return max
}
