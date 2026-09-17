/**
 * 选择页真正需要的部件库切片。
 *
 * 正式程序已经由 `PartLibrary.load()` 下载、校验过一次 `parts.json`。选择页只需要
 * 条目和“每个条目有几件自有部件”，不该为了这两个投影再下载和解析同一份 185KB JSON。
 * `sourceAvailable` 必须单独保留：内置占位目录能让缺资产时仍有一具身体可选，但它
 * 不能反过来否掉 `?theme=xeno` 这种手动覆盖——源文件缺席时我们根本无权说它不存在。
 */
import type { PartLibraryIndex, ThemeDef } from '../../../core/src/types.ts';

export interface ChooseCatalog {
  themes: ThemeDef[];
  /** theme id → 库里有多少件自有部件 */
  partCount: Map<string, number>;
  /** false = 权威索引没有读到；这时不能用占位目录否定手动覆盖 */
  sourceAvailable: boolean;
}

interface CatalogIndex {
  themes?: unknown;
  parts?: unknown;
}

/** 旧索引缺 roster 字段时补显示默认值；坏条目只丢自己，不拖垮整页。 */
function normalize(raw: Partial<ThemeDef> & { id: string }): ThemeDef {
  return {
    id: raw.id,
    kind: raw.kind ?? 'archetype',
    name: raw.name ?? raw.id,
    nameEn: raw.nameEn ?? raw.id,
    tagline: raw.tagline ?? '',
    taglineEn: raw.taglineEn ?? '',
    palette: Array.isArray(raw.palette) ? raw.palette : [],
    source: raw.source ?? 'rodin',
    axes: raw.axes ?? { humanLike: 0.5, lifeLike: 0.5 },
    coverage: raw.coverage ?? 'light',
    base: raw.base,
  };
}

export function catalogFromIndex(
  index: Pick<PartLibraryIndex, 'themes' | 'parts'> | CatalogIndex,
  sourceAvailable = true,
): ChooseCatalog {
  const rawThemes = Array.isArray(index.themes) ? index.themes : [];
  const themes = rawThemes
    .filter((t): t is Partial<ThemeDef> & { id: string } =>
      !!t && typeof t === 'object' && typeof (t as { id?: unknown }).id === 'string')
    .map(normalize);
  const partCount = new Map<string, number>();
  for (const p of Array.isArray(index.parts) ? index.parts : []) {
    const family = p && typeof p === 'object' ? (p as { family?: unknown }).family : null;
    if (typeof family === 'string' && family) partCount.set(family, (partCount.get(family) ?? 0) + 1);
  }
  return { themes, partCount, sourceAvailable };
}

export function catalogKnowsTheme(catalog: ChooseCatalog, id: string): boolean {
  return !catalog.sourceAvailable
    || catalog.themes.length === 0
    || catalog.themes.some((t) => t.id === id);
}

type CatalogFetcher = (url: string) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export async function fetchChooseCatalog(
  url: string,
  request: CatalogFetcher = (target) => fetch(target),
): Promise<ChooseCatalog> {
  try {
    const res = await request(url);
    if (!res.ok) throw new Error(`${res.status}`);
    return catalogFromIndex((await res.json() ?? {}) as CatalogIndex);
  } catch {
    // 缺 parts.json 是正式降级路径。调用方可继续展示自己提供的占位目录。
    return catalogFromIndex({}, false);
  }
}

export interface ChooseCatalogSource {
  catalog?: ChooseCatalog;
  themes?: ThemeDef[];
  partsUrl?: string;
}

export interface ResolvedChooseCatalog {
  catalog: ChooseCatalog;
  /** dev / 演示直接给的 themes 没有部件表，轮播按约定全部放行。 */
  callerSuppliedThemes: boolean;
}

export async function resolveChooseCatalog(
  source: ChooseCatalogSource,
  request?: CatalogFetcher,
): Promise<ResolvedChooseCatalog> {
  if (source.themes) {
    return {
      catalog: catalogFromIndex({ themes: source.themes, parts: [] }),
      callerSuppliedThemes: true,
    };
  }
  if (source.catalog) return { catalog: source.catalog, callerSuppliedThemes: false };
  return {
    catalog: await fetchChooseCatalog(source.partsUrl ?? '/parts/parts.json', request),
    callerSuppliedThemes: false,
  };
}
