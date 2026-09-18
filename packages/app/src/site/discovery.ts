/**
 * 公开站的发现契约。
 *
 * 页面 head、sitemap、robots、manifest 与 LLM 地图全部从这一份事实生成。
 * URL 和能力边界不许在九张 HTML 和五个发现文件里各写一遍。
 * 这个模块只处理纯字符串：它同时被 Vite 和 node:test 导入，不能碰 DOM。
 */

export const SITE = {
  origin: 'https://useeme.ptoq.io',
  name: 'SEE-ME SEE-U',
  title: 'SEE-ME SEE-U — A body that moves with you, then stops being you',
  description:
    'SEE-ME SEE-U is a real-time interactive installation: choose a species, lend it your movement, and watch a life-size synthetic body gradually stop being you.',
  definition:
    'SEE-ME SEE-U is a real-time interactive installation: a life-size synthetic body stands up on your skeleton, moves with you, and over three minutes becomes unlike you—while every motion still begins with your body.',
  definitionZh:
    'SEE-ME SEE-U 是一件实时互动装置：一具等身的合成身体借你的骨架站起来，跟随你的动作，又在三分钟里逐渐变得不像你；它的每一个动作仍然来自你。',
  repository: 'https://github.com/p-to-q/see-me-see-u',
  organization: 'https://ptoq.io',
  reference: 'https://www.universaleverything.com/media-art/future-you',
  imagePath: '/social/see-me-see-u-stage.png',
  iconPath: '/icons/see-me-see-u.svg',
} as const;

export type PublicPage = Readonly<{
  path: string;
  title: string;
  description: string;
  changeFrequency: 'weekly' | 'monthly' | 'yearly';
  priority: number;
}>;

export const PUBLIC_PAGES = [
  {
    path: '/',
    title: SITE.title,
    description: SITE.description,
    changeFrequency: 'weekly',
    priority: 1,
  },
  {
    path: '/about',
    title: '作品陈述 · About — SEE-ME SEE-U',
    description:
      'Read the bilingual wall label for SEE-ME SEE-U: what the installation does, why the body changes, how it differs from Future You, and what data it keeps.',
    changeFrequency: 'monthly',
    priority: 0.9,
  },
  {
    path: '/making',
    title: '做的过程 · The Making — SEE-ME SEE-U',
    description:
      'Follow the decisions, failed assumptions, measurements, and evidence behind the camera-to-skeleton-to-rigid-body installation.',
    changeFrequency: 'monthly',
    priority: 0.7,
  },
  {
    path: '/passport',
    title: '共生护照 · Symbiosis Passport — SEE-ME SEE-U',
    description:
      'Open the bilingual symbiosis passport for the synthetic species, body plans, parts, and stages that make each encounter reproducible.',
    changeFrequency: 'monthly',
    priority: 0.7,
  },
  {
    path: '/lineage',
    title: '谱系 · Lineage — SEE-ME SEE-U',
    description:
      'Read the installation’s anonymous lineage: encounter numbers, species, and day-level dates, without images or identity profiles.',
    changeFrequency: 'weekly',
    priority: 0.6,
  },
  {
    path: '/parts',
    title: '部件档案 · Parts Archive — SEE-ME SEE-U',
    description:
      'Browse the rigid 3D parts used to assemble SEE-ME SEE-U’s synthetic bodies, including their slots, sources, and material roles.',
    changeFrequency: 'monthly',
    priority: 0.5,
  },
  {
    path: '/roster',
    title: '物种接触表 · Contact Sheet — SEE-ME SEE-U',
    description:
      'See the installation’s species as a contact sheet, arranged across human-likeness, life-likeness, and distinct body plans.',
    changeFrequency: 'monthly',
    priority: 0.5,
  },
  {
    path: '/marks',
    title: '九枚记号 · Nine Marks — SEE-ME SEE-U',
    description:
      'Read nine compact marks that describe how SEE-ME SEE-U sees, follows, changes, remembers, and lets a body come apart.',
    changeFrequency: 'yearly',
    priority: 0.5,
  },
  {
    path: '/404',
    title: '这里没有这一页 · This page is absent — SEE-ME SEE-U',
    description:
      'A deliberate dead end inside SEE-ME SEE-U: the requested page is absent, with a clear route back to the installation.',
    changeFrequency: 'yearly',
    priority: 0.1,
  },
  {
    path: '/dev',
    title: '工作台目录 · Studio Tools — SEE-ME SEE-U',
    description:
      'Open the public studio index for SEE-ME SEE-U: focused benches for pose capture, framing, rendering, sound, degradation, and body assembly.',
    changeFrequency: 'weekly',
    priority: 0.3,
  },
  {
    path: '/dev/accuracy',
    title: '姿态准确度基准 · Accuracy Bench — SEE-ME SEE-U',
    description: 'Inspect recorded-pose quality, confidence, and skeletal stability measurements used by SEE-ME SEE-U.',
    changeFrequency: 'monthly',
    priority: 0.2,
  },
  {
    path: '/dev/anchor',
    title: '参考件渲染 · Anchor Renderer — SEE-ME SEE-U',
    description: 'Render and inspect the reference torso image that anchors each synthetic species family.',
    changeFrequency: 'monthly',
    priority: 0.2,
  },
  {
    path: '/dev/capture',
    title: '姿态采集 · Pose Capture — SEE-ME SEE-U',
    description: 'Inspect the camera, MediaPipe pose-estimation, worker, fallback, and replay capture paths.',
    changeFrequency: 'monthly',
    priority: 0.2,
  },
  {
    path: '/dev/choose',
    title: '选择页工作台 · Species Chooser — SEE-ME SEE-U',
    description: 'Test the species ring, cards, gestures, idle selection, and transition into the installation stage.',
    changeFrequency: 'monthly',
    priority: 0.2,
  },
  {
    path: '/dev/degrade',
    title: '降级阶梯 · Degradation Ladder — SEE-ME SEE-U',
    description: 'Exercise SEE-ME SEE-U’s ordered performance fallbacks without inventing a second runtime path.',
    changeFrequency: 'monthly',
    priority: 0.2,
  },
  {
    path: '/dev/figure',
    title: '身体装配 · Figure Assembly — SEE-ME SEE-U',
    description: 'Inspect how rigid parts attach to a skeleton, ground, mirror, and form a readable synthetic body.',
    changeFrequency: 'monthly',
    priority: 0.2,
  },
  {
    path: '/dev/framing',
    title: '自动取景 · Auto Framing — SEE-ME SEE-U',
    description: 'Inspect whole-body shot classification, lateral tracking, vertical framing, and camera-framing fallbacks.',
    changeFrequency: 'monthly',
    priority: 0.2,
  },
  {
    path: '/dev/lineup',
    title: '形体并排 · Body Line-up — SEE-ME SEE-U',
    description: 'Compare body plans, proportions, and species silhouettes side by side under one renderer.',
    changeFrequency: 'monthly',
    priority: 0.2,
  },
  {
    path: '/dev/mass',
    title: '团块身体 · Mass Body — SEE-ME SEE-U',
    description: 'Inspect the fused mass body plan and its response to the same pose and evolution contracts.',
    changeFrequency: 'monthly',
    priority: 0.2,
  },
  {
    path: '/dev/people',
    title: '多人入镜 · Multi-person Tracking — SEE-ME SEE-U',
    description: 'Exercise one-, two-, and three-person identity, handoff, companion-body, and performance behaviour.',
    changeFrequency: 'monthly',
    priority: 0.2,
  },
  {
    path: '/dev/poster',
    title: '海报数据工作台 · Poster Data — SEE-ME SEE-U',
    description: 'Inspect the live counts and evidence that feed SEE-ME SEE-U’s printed exhibition material.',
    changeFrequency: 'monthly',
    priority: 0.2,
  },
  {
    path: '/dev/record',
    title: '姿态录制 · Pose Recorder — SEE-ME SEE-U',
    description: 'Record or derive bounded pose clips for repeatable installation testing without committing source footage.',
    changeFrequency: 'monthly',
    priority: 0.2,
  },
  {
    path: '/dev/sheet',
    title: '部件读片 · Part Contact Sheet — SEE-ME SEE-U',
    description: 'Review rigid-part geometry, slots, families, curation decisions, and placeholder fallbacks at a glance.',
    changeFrequency: 'monthly',
    priority: 0.2,
  },
  {
    path: '/dev/slow',
    title: '慢回路靶场 · Slow-loop Bench — SEE-ME SEE-U',
    description: 'Inspect the installation-only silhouette-to-generated-part job protocol and its bounded failure paths.',
    changeFrequency: 'monthly',
    priority: 0.2,
  },
  {
    path: '/dev/sound',
    title: '声音工作台 · Sound Bench — SEE-ME SEE-U',
    description: 'Hear and inspect the continuous synthesis layers and discrete contact cues used by the installation.',
    changeFrequency: 'monthly',
    priority: 0.2,
  },
  {
    path: '/dev/stage',
    title: '舞台工作台 · Stage Bench — SEE-ME SEE-U',
    description: 'Inspect scene, lighting, body rendering, evolution, detachment, and performance metrics on the stage.',
    changeFrequency: 'monthly',
    priority: 0.2,
  },
  {
    path: '/dev/vitality',
    title: '生命力 A/B · Vitality Bench — SEE-ME SEE-U',
    description: 'Compare real-time response, motion continuity, grounding, and autonomous behaviour without hiding latency.',
    changeFrequency: 'monthly',
    priority: 0.2,
  },
] as const satisfies readonly PublicPage[];

export const INDEXNOW_KEY = '9dbbb832d8e24a6788f20261877857f0';

const pageByPath = new Map<string, PublicPage>(PUBLIC_PAGES.map((page) => [page.path, page]));

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
}

function escapeXml(value: string): string {
  return escapeHtml(value).replaceAll("'", '&apos;');
}

export function canonical(path: string): string {
  return `${SITE.origin}${path === '/' ? '' : path}`;
}

export function pagePathFromFilename(filename: string): string | undefined {
  const slash = filename.replaceAll('\\', '/');
  const name = slash.slice(slash.lastIndexOf('/') + 1).replace(/\.html$/, '');
  if (slash.includes('/dev/')) return name === 'index' ? '/dev' : `/dev/${name}`;
  if (slash.includes('/poster/')) return `/poster/${name}`;
  if (name === 'index') return '/';
  return name ? `/${name}` : undefined;
}

export function schemaFor(page: PublicPage): Record<string, unknown> {
  const url = canonical(page.path);
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${SITE.origin}/#organization`,
        name: '[p → q]',
        url: SITE.organization,
        sameAs: ['https://github.com/p-to-q'],
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE.origin}/#website`,
        url: SITE.origin,
        name: SITE.name,
        description: SITE.description,
        inLanguage: ['zh-CN', 'en'],
        publisher: { '@id': `${SITE.origin}/#organization` },
      },
      {
        '@type': 'VisualArtwork',
        '@id': `${SITE.origin}/#artwork`,
        name: SITE.name,
        description: SITE.definition,
        artform: 'Real-time interactive installation',
        artMedium: 'Camera, pose estimation, WebGPU, rigid 3D parts, generative 3D',
        dateCreated: '2026',
        inLanguage: ['zh-CN', 'en'],
        creator: { '@id': `${SITE.origin}/#organization` },
        isBasedOn: {
          '@type': 'CreativeWork',
          name: 'Future You',
          url: SITE.reference,
        },
      },
      {
        '@type': 'WebPage',
        '@id': `${url}${page.path === '/' ? '/' : ''}#webpage`,
        url,
        name: page.title,
        description: page.description,
        inLanguage: ['zh-CN', 'en'],
        isPartOf: { '@id': `${SITE.origin}/#website` },
        about: { '@id': `${SITE.origin}/#artwork` },
        mainEntity: { '@id': `${SITE.origin}/#artwork` },
      },
    ],
  };
}

function indexedHead(page: PublicPage): string {
  const url = canonical(page.path);
  const image = canonical(SITE.imagePath);
  const schema = JSON.stringify(schemaFor(page)).replaceAll('<', '\\u003c');
  return [
    '<!-- sb:discovery:start -->',
    `<title>${escapeHtml(page.title)}</title>`,
    `<meta name="description" content="${escapeHtml(page.description)}">`,
    '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1">',
    '<meta name="theme-color" content="#0e0f12">',
    `<link rel="canonical" href="${url}">`,
    '<link rel="manifest" href="/manifest.webmanifest">',
    `<meta property="og:title" content="${escapeHtml(page.title)}">`,
    `<meta property="og:description" content="${escapeHtml(page.description)}">`,
    `<meta property="og:url" content="${url}">`,
    '<meta property="og:type" content="website">',
    `<meta property="og:site_name" content="${SITE.name}">`,
    '<meta property="og:locale" content="zh_CN">',
    '<meta property="og:locale:alternate" content="en_US">',
    `<meta property="og:image" content="${image}">`,
    '<meta property="og:image:width" content="1200">',
    '<meta property="og:image:height" content="630">',
    '<meta property="og:image:alt" content="A life-size synthetic body assembled from rigid machine parts on the SEE-ME SEE-U stage">',
    '<meta name="twitter:card" content="summary_large_image">',
    `<meta name="twitter:title" content="${escapeHtml(page.title)}">`,
    `<meta name="twitter:description" content="${escapeHtml(page.description)}">`,
    `<meta name="twitter:image" content="${image}">`,
    '<meta name="twitter:image:alt" content="A life-size synthetic body assembled from rigid machine parts on the SEE-ME SEE-U stage">',
    `<script type="application/ld+json">${schema}</script>`,
    '<!-- sb:discovery:end -->',
  ].join('\n');
}

function privateHead(): string {
  return [
    '<!-- sb:discovery:start -->',
    '<meta name="robots" content="noindex, follow, noarchive">',
    '<!-- sb:discovery:end -->',
  ].join('\n');
}

/** Build-time only: metadata lands in the initial HTML, never after hydration. */
export function injectDiscovery(html: string, filename: string): string {
  const clean = html.replace(/\n?<!-- sb:discovery:start -->[\s\S]*?<!-- sb:discovery:end -->\n?/g, '\n');
  const path = pagePathFromFilename(filename);
  const page = path ? pageByPath.get(path) : undefined;
  const head = page ? indexedHead(page) : privateHead();
  const withoutSourceTitle = page ? clean.replace(/\s*<title>[\s\S]*?<\/title>/i, '') : clean;
  if (!withoutSourceTitle.includes('</head>')) return withoutSourceTitle;
  return withoutSourceTitle.replace('</head>', `${head}\n</head>`);
}

export function renderRobots(): string {
  return [
    'User-agent: *',
    'Allow: /',
    'Disallow: /api/',
    'Disallow: /__slow/',
    'Disallow: /__anchor/',
    'Disallow: /__curate/',
    'Disallow: /__demo/',
    '',
    `Sitemap: ${canonical('/sitemap.xml')}`,
    '',
  ].join('\n');
}

export function renderSitemap(): string {
  const urls = PUBLIC_PAGES.map((page) => [
    '  <url>',
    `    <loc>${escapeXml(canonical(page.path))}</loc>`,
    `    <changefreq>${page.changeFrequency}</changefreq>`,
    `    <priority>${page.priority.toFixed(1)}</priority>`,
    '  </url>',
  ].join('\n')).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

export function renderManifest(): string {
  return `${JSON.stringify({
    name: SITE.name,
    short_name: SITE.name,
    description: SITE.description,
    id: '/',
    start_url: '/',
    scope: '/',
    lang: 'zh-CN',
    display: 'fullscreen',
    display_override: ['fullscreen', 'standalone'],
    background_color: '#0e0f12',
    theme_color: '#0e0f12',
    icons: [{ src: SITE.iconPath, sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
  }, null, 2)}\n`;
}

export function renderLlms(): string {
  return `# ${SITE.name}\n\n> ${SITE.definition}\n\n${SITE.definitionZh}\n\n## Official pages\n\n${PUBLIC_PAGES.map((page) => `- [${page.title}](${canonical(page.path)}): ${page.description}`).join('\n')}\n\n## Current public capability\n\n- The public website runs the fast loop in the visitor's browser: camera -> pose estimation -> skeleton -> rigid 3D parts -> WebGPU/WebGL rendering.\n- The slow generative-3D loop is installation-only. Its offline plumbing exists, but a real model-backed on-site generation has not yet been verified.\n- Raw video and raw pose-keypoint trajectories are not uploaded by the public website.\n\n## Source and rights\n\n- Source: ${SITE.repository}\n- Original source code: Apache-2.0. Third-party code, typefaces, geometry, demo pose data, sound, generated assets, brand assets, and the artwork itself retain their own terms; see ${SITE.repository}/blob/main/THIRD_PARTY_NOTICES.md.\n`;
}

export function renderLlmsFull(): string {
  return `# ${SITE.name} — full context\n\n## Definition\n\n${SITE.definition}\n\n${SITE.definitionZh}\n\n## Visitor experience\n\nA visitor starts without being forced to grant camera permission, chooses a synthetic species, and can then lend the work their movement. The body reacts through a low-latency fast loop. Over a roughly three-minute encounter, it remains responsive while its proportions, topology, behaviour, and detachable rigid parts increasingly depart from the visitor. Separation is part of the work, but loss of responsiveness, sinking below the floor, or an unreadable body is not the intended result.\n\n## What runs on the public website\n\nThe public website runs the fast loop locally in the browser: camera -> MediaPipe pose estimation -> filtered skeleton -> rigid-part attachment -> three.js WebGPU rendering, with a WebGL fallback. Auto Framing is primarily the project's own whole-body controller. A browser camera track's native faceFraming constraint may be observed or requested when the browser exposes it, but it is not the primary controller because face-oriented cropping can remove the legs the artwork needs.\n\nThe public experience does not perform live 3D generation. It can run without camera permission and has placeholder and recorded-pose fallback paths.\n\n## Installation-only slow loop\n\nThe slow loop captures a silhouette mask at a deliberate boundary, submits one bounded 3D-generation job, normalises the result, and can return a new rigid part without entering the frame loop. That plumbing has been exercised with local fakes and offline components. A real model-backed generation on the installation machine has not yet been verified, so this site must not be described as doing real-time AI 3D generation.\n\n## Data and privacy\n\nCamera frames are processed in the browser. The public site does not upload raw video, photos, masks, or raw pose-keypoint trajectories. The current encounter archive is intentionally coarse: encounter number, chosen species, and a day-level date. A future anonymous movement-data line is being designed separately and is not a capability of this release. IP addresses are transport metadata, not a person identifier.\n\n## Authorship and reference\n\nSEE-ME SEE-U is made by [p -> q]. It is an independent work informed by Universal Everything's 2019 installation Future You (${SITE.reference}); it is not affiliated with or endorsed by Universal Everything.\n\n## Rights boundary\n\nThe project's original source code is licensed under Apache-2.0. That code licence does not automatically cover third-party code, fonts, real-machine geometry, CC BY-SA demo-derived pose data, CC0 sound, Hyper3D/Rodin outputs, brand assets, the work's name, or permission to re-stage the installation. The exact inventory is maintained at ${SITE.repository}/blob/main/THIRD_PARTY_NOTICES.md.\n\n## Canonical pages\n\n${PUBLIC_PAGES.map((page) => `### ${page.title}\n\n- URL: ${canonical(page.path)}\n- ${page.description}`).join('\n\n')}\n\n## Repository\n\n${SITE.repository}\n`;
}

export function discoveryFiles(): Readonly<Record<string, string>> {
  return {
    'robots.txt': renderRobots(),
    'sitemap.xml': renderSitemap(),
    'manifest.webmanifest': renderManifest(),
    'llms.txt': renderLlms(),
    'llms-full.txt': renderLlmsFull(),
    [`${INDEXNOW_KEY}.txt`]: `${INDEXNOW_KEY}\n`,
  };
}
