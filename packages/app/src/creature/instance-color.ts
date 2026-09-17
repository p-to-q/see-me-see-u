/** 只在实例颜色真的变化时写缓冲；稳定单人不能每帧上传一份全白颜色。 */
const clean = (v: number | undefined): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;

export function writeInstanceColor(
  array: Float32Array,
  index: number,
  color: readonly [number, number, number] | null,
): boolean {
  if (!Number.isInteger(index) || index < 0 || index * 3 + 2 >= array.length) return false;
  const offset = index * 3;
  // Buffer 里是 float32；比较也必须先落到同一精度，否则 0.4 之类的值会每帧都被误判成变化。
  const r = Math.fround(clean(color?.[0]));
  const g = Math.fround(clean(color?.[1]));
  const b = Math.fround(clean(color?.[2]));
  if (array[offset] === r && array[offset + 1] === g && array[offset + 2] === b) return false;
  array[offset] = r;
  array[offset + 1] = g;
  array[offset + 2] = b;
  return true;
}
