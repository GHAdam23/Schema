let counter = 0;
export function newId(prefix = ''): string {
  counter = (counter + 1) % 1e6;
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + counter.toString(36);
}
