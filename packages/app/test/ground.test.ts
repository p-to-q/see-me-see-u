/**
 * 端到端：**装配出来的身体真的站在地面上**，七种身体方案都一样。
 *
 * 为什么这条测试非有不可：`core/test/ground.test.ts` 证的是那段几何数学对，
 * 但它证不了装配那条路**调用了**它 —— 而 bug 恰恰是"少了一步"，不是"那一步算错了"。
 * 一个只测纯函数的套件在修之前和修之后都是绿的，那就不是仪表（P21）。
 * 所以这里跑的是真的 `assemble()`：给它参考站姿、给它七种拓扑，量它吐出来的矩阵。
 *
 * 量法与渲染端一致：每件的局部 aabb 过它自己的挂载矩阵，取全身最低的那个角。
 * 这也是这条测试唯一"自己写"的数学 —— 故意不复用 `core/ground.ts`，
 * 否则就变成"用同一段代码验证它自己"。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { assemble } from '../src/creature/assemble.ts';
import { crossfadeRenders, graftCurve, REPLACE_SECONDS, replaceRenders } from '../src/creature/replace-event.ts';
import { REFERENCE_POSE } from '../src/stage/framing.ts';
import { BODY_PLANS, remapSkeleton, type BodyPlanId } from '../../core/src/bodyplan.ts';
import { makeGenome } from '../../core/src/genome.ts';
import { ALL_BONE_IDS } from '../../core/src/slots.ts';
import type {
  Genome, Mat4, PartLibraryIndex, PartMeta, Skeleton, Slot, SlotKey, Vec3,
} from '../../core/src/types.ts';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
let REAL_INDEX: PartLibraryIndex | null = null;
try { REAL_INDEX = JSON.parse(read('../../../assets/parts/parts.json')) as PartLibraryIndex; } catch { /* P3: 无资产仍可跑 */ }

/**
 * 一套"每个槽位一件"的假部件。包围盒照抄 parts.json 的形状约定：
 * 长度归一化到 1（沿 +Y，socketA 在原点），横向对称。
 * 数值取自 `foot.porcelain.a` 一类的真实件，不是随手编的小盒子 ——
 * 编一个薄片会让这条测试在"其实还沉着"的情况下也变绿。
 */
const HALF = 0.27;
const META: Record<string, PartMeta> = {};
function metaOf(partId: string): PartMeta {
  const slot = partId.slice('part:'.length) as Slot;
  META[partId] ??= {
    id: partId, slot, tier: 0, file: '', family: 'test',
    localGirth: HALF * 2, triCount: 12,
    aabb: { min: [-HALF, 0, -HALF], max: [HALF, 1, HALF] },
    symmetry: 'mirror',
  };
  return META[partId];
}

const GENOME: Genome = {
  seed: 1, tier: 1, theme: 'test',
  slots: Object.fromEntries(
    ([...ALL_BONE_IDS, 'joint'] as SlotKey[]).map((k) => {
      const slot = k === 'joint' ? 'joint' : slotOf(k);
      return [k, { partId: `part:${slot}`, materialRole: 'primary' as const }];
    }),
  ) as Genome['slots'],
  materials: { primary: 'm', secondary: 'm', accent: 'm' },
};

/** BoneId → Slot。抄 `core/slots.ts` 的表太啰嗦，这里只要一个能用的映射 */
function slotOf(bone: string): Slot {
  const raw = bone.replace(/[LR]$/, '');
  return (raw === 'footIdx' ? 'foot' : raw) as Slot;
}

/** 一件部件被它自己的挂载矩阵变换之后的世界最低点（八个角，老老实实全算） */
function lowestOf(m: Mat4, aabb: { min: Vec3; max: Vec3 }): number {
  let lo = Infinity;
  for (const x of [aabb.min[0], aabb.max[0]]) {
    for (const y of [aabb.min[1], aabb.max[1]]) {
      for (const z of [aabb.min[2], aabb.max[2]]) {
        lo = Math.min(lo, m[1] * x + m[5] * y + m[9] * z + m[13]);
      }
    }
  }
  return lo;
}

function lowestMeshPoint(sk: Skeleton): number {
  const parts = assemble(GENOME, sk, { metaOf }, {});
  assert.ok(parts.length > 0, '参考站姿应当装配出部件');
  let lo = Infinity;
  for (const p of parts) lo = Math.min(lo, lowestOf(p.matrix, metaOf(p.partId).aabb));
  return lo;
}

for (const plan of BODY_PLANS as readonly BodyPlanId[]) {
  test(`落地：${plan} 的网格最低点落在地面上`, () => {
    const sk = remapSkeleton(REFERENCE_POSE, plan);
    const lo = lowestMeshPoint(sk);
    assert.ok(Number.isFinite(lo), `${plan} 量出了 NaN`);
    // 修之前这里是 -0.03 ~ -0.06（人形）乃至 -0.3（四足的前腿）。
    // 允许的误差只有浮点噪声：`几乎贴地` 不是一条可以慢慢漂的标准。
    assert.ok(Math.abs(lo) < 1e-9, `${plan} 的网格最低点应当是 0，实测 ${lo}`);
  });
}

test('落地：抬的是网格，不是骨架 —— 关节该留在原地', () => {
  // 这条把"修法对不对"钉死：如果有人图省事去改骨架的落地基准，
  // 上面七条会照样绿，但接触阴影（`framing.ts` 的 contactPoints 以 y=0 为参照）
  // 就会跟着脚一起往上跑，影子画在没有脚的地方。
  //
  // 参考站姿本身的脚尖在 y=0.03（它是给取景用的，没落过地），
  // 而真正喂给装配的骨架是稳定器落过地的 —— 这里先补上那一步，量的才是运行时那件事。
  const sk = groundedAtFeet(remapSkeleton(REFERENCE_POSE, 'rig'));
  const before = JSON.stringify(sk.joints);

  assert.ok(Math.abs(lowestMeshPoint(sk)) < 1e-9, '网格落在地面上');
  assert.equal(JSON.stringify(sk.joints), before, 'assemble() 不许改写传进来的骨架');

  const lowestJoint = Math.min(...Object.values(sk.joints).map((v) => v[1]));
  assert.ok(Math.abs(lowestJoint) < 1e-9, '最低的脚关节仍然在 y=0 —— 动的是网格，不是骨架');
});

/** 把骨架整体平移，让最低的脚关节回到 y=0（docs/04 §3.5，稳定器每帧干的那件事） */
function groundedAtFeet(sk: Skeleton): Skeleton {
  let lo = Infinity;
  for (const n of ['footIdxL', 'footIdxR', 'ankleL', 'ankleR']) {
    const y = sk.joints[n]?.[1];
    if (Number.isFinite(y) && y < lo) lo = y;
  }
  if (!Number.isFinite(lo)) return sk;
  const joints: Record<string, Vec3> = {};
  for (const k in sk.joints) joints[k] = [sk.joints[k][0], sk.joints[k][1] - lo, sk.joints[k][2]];
  return {
    ...sk,
    joints,
    bones: sk.bones.map((b) => ({
      ...b,
      p0: [b.p0[0], b.p0[1] - lo, b.p0[2]] as Vec3,
      p1: [b.p1[0], b.p1[1] - lo, b.p1[2]] as Vec3,
    })),
  };
}

test('落地：一个部件都不实例化时（mass / 进场缩到 0）什么都不做', () => {
  const sk = remapSkeleton(REFERENCE_POSE, 'rig');
  const empty = assemble(GENOME, sk, { metaOf }, {
    render: Object.fromEntries(([...ALL_BONE_IDS, 'joint'] as SlotKey[]).map((k) => [k, []])),
  });
  assert.equal(empty.length, 0, '全空的渲染表应当装配出 0 件');
});

test('落地：部件缺 aabb 时不产生 NaN 矩阵（parts.json 是外部数据）', () => {
  const sk = remapSkeleton(REFERENCE_POSE, 'rig');
  const blind = {
    metaOf: (id: string): PartMeta => ({ ...metaOf(id), aabb: undefined as unknown as PartMeta['aabb'] }),
  };
  const parts = assemble(GENOME, sk, blind, {});
  assert.ok(parts.length > 0);
  for (const p of parts) {
    assert.ok(p.matrix.every(Number.isFinite), `${p.key} 的矩阵出现了 NaN`);
  }
});

/** 找到未替换的头部件，它的 Y 变化就是整具主体被落地算法搬了多少。 */
function headY(parts: ReturnType<typeof assemble>): number {
  const head = parts.find((p) => p.key === 'head');
  assert.ok(head, '回归必须装配出一件头部，否则没有量到稳定部位');
  return head.matrix[13];
}

test('落地：真实全槽位同件替换的芯 / 碎屑 / 飞入件不再让稳定部位泵动', { skip: !REAL_INDEX }, () => {
  const genome = makeGenome(11, 2, REAL_INDEX!, { theme: 'porcelain' });
  const byId = new Map(REAL_INDEX!.parts.map((p) => [p.id, p]));
  const source = {
    metaOf(id: string): PartMeta {
      const meta = byId.get(id);
      assert.ok(meta, `parts.json 里找不到 ${id}`);
      return meta;
    },
  };
  const baselineParts = assemble(genome, REFERENCE_POSE, source);

  // 修之前 replace 的 t=0.65 会把头连同整具身体抬高 33.2mm；
  // 这里连脚在内扫完全部槽位、忒修斯替换与 graft/remorph 交接的全部阶段。
  for (const key of [...ALL_BONE_IDS, 'joint'] as SlotKey[]) {
    const pick = genome.slots[key];
    assert.ok(pick, `真实 genome 必须有 ${key} 件`);
    const probeKey = key === 'head' ? 'spine' : 'head';
    const baseline = baselineParts.find((p) => p.key === probeKey);
    assert.ok(baseline, `${key} 回归找不到稳定探针 ${probeKey}`);

    for (const [kind, renders] of [['replace', replaceRenders], ['crossfade', crossfadeRenders]] as const) {
      for (let i = 0; i <= 20; i++) {
        const t = i / 20;
        const effect = renders(key, pick, pick, t);
        assert.ok(effect.every((r) => r.groundsBody === false), `${kind} ${key} 混进了会决定 lift 的效果实例`);
        const parts = assemble(genome, REFERENCE_POSE, source, {
          render: { [key]: effect },
          ground: { [key]: [{ partId: pick.partId, materialRole: pick.materialRole }] },
        });
        const probe = parts.find((p) => p.key === probeKey);
        assert.ok(probe, `${kind} ${key} t=${t.toFixed(2)} 找不到稳定探针`);
        for (let n = 0; n < 16; n++) {
          const delta = probe.matrix[n] - baseline.matrix[n];
          assert.ok(Math.abs(delta) < 1e-12,
            `${kind} ${key} t=${t.toFixed(2)} 把 ${probeKey} 矩阵[${n}] 搬了 ${delta}`);
        }
      }
    }
  }
});

test('落地：真实脚部 old→new 的 AABB 基准走完整交接，不在最后一帧跳 45mm', { skip: !REAL_INDEX }, (t) => {
  const fromGenome = makeGenome(1, 3, REAL_INDEX!, { theme: 'wheelleg' });
  const donor = makeGenome(1, 3, REAL_INDEX!, { theme: 'screenface' });
  const key: SlotKey = 'footL';
  const from = fromGenome.slots[key];
  const to = donor.slots[key];
  assert.ok(from && to, '真实夹具必须有新旧两只脚');
  assert.notEqual(from.partId, to.partId, '夹具必须真的换件');

  const genome: Genome = {
    ...fromGenome,
    slots: { ...fromGenome.slots, [key]: to },
  };
  const byId = new Map(REAL_INDEX!.parts.map((p) => [p.id, p]));
  const source = {
    metaOf(id: string): PartMeta {
      const meta = byId.get(id);
      assert.ok(meta, `parts.json 里找不到 ${id}`);
      return meta;
    },
  };
  const proxy = (pick: typeof from) => [{
    partId: pick!.partId, materialRole: pick!.materialRole,
  }];
  const at = (u: number, continuous: boolean): number => headY(assemble(genome, REFERENCE_POSE, source, {
    render: { [key]: replaceRenders(key, from, to, u) },
    ground: { [key]: proxy(from) },
    groundTo: continuous ? { [key]: proxy(to) } : undefined,
    groundProgress: continuous ? { [key]: graftCurve(u).scale } : undefined,
  }));
  const done = headY(assemble(genome, REFERENCE_POSE, source));

  // 对照组：旧实现把旧脚代理用到事件最后，下一帧直接切新脚。这个真资产组合会跳约 45mm。
  const oldLast = at(1 - 1 / 72, false);
  const oldJump = Math.abs(done - oldLast);
  t.diagnostic(`旧代理终点跳变 ${(oldJump * 1000).toFixed(2)}mm`);
  assert.ok(oldJump > 0.04, `夹具只量到 ${(oldJump * 1000).toFixed(2)}mm，不能证明修复有效`);

  // 正式动画 1.2s @60Hz。落地基准按各槽位自己的进度连续走，终点必须等于正常装配。
  const frames = Math.max(1, Math.round(REPLACE_SECONDS * 60));
  let previous = at(0, true);
  let worst = 0;
  for (let frame = 1; frame <= frames; frame++) {
    const current = at(frame / frames, true);
    worst = Math.max(worst, Math.abs(current - previous));
    previous = current;
  }
  t.diagnostic(`连续代理最坏单帧 ${(worst * 1000).toFixed(3)}mm / ${frames} 帧`);
  assert.ok(worst <= 0.001, `落地代理单帧仍跳 ${(worst * 1000).toFixed(2)}mm`);
  assert.ok(Math.abs(previous - done) < 1e-12, '交接终点必须逐位回到正式新身体的落地基准');

  const bad = at(Number.NaN, true);
  assert.ok(Number.isFinite(bad), '坏进度不能把帧循环送进 NaN');
});

test('落地：parts.json 缺失的占位身体在替换中仍有限、不泵动', () => {
  const emptyIndex: PartLibraryIndex = {
    version: 0,
    units: 'meters',
    convention: { axis: '+Y', socketA: [0, 0, 0], socketB: [0, 1, 0], length: 1 },
    themes: [{
      id: 'placeholder', kind: 'archetype', name: '原型', nameEn: 'Proto', tagline: '',
      palette: [], source: 'procedural', axes: { humanLike: 0.5, lifeLike: 0.2 }, coverage: 'full',
    }],
    materials: [],
    parts: [],
  };
  const genome = makeGenome(1, 1, emptyIndex, { theme: 'placeholder' });
  const source = {
    metaOf(id: string): PartMeta {
      const slot = id.slice('placeholder:'.length) as Slot;
      return {
        id, slot, tier: 0, file: '', family: 'placeholder', localGirth: 1, triCount: 0,
        aabb: { min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] }, symmetry: 'none',
      };
    },
  };
  const pick = genome.slots.joint;
  const baseline = headY(assemble(genome, REFERENCE_POSE, source));
  for (const [kind, renders] of [['replace', replaceRenders], ['crossfade', crossfadeRenders]] as const) {
    for (const t of [0, 0.25, 0.65, 1]) {
      const parts = assemble(genome, REFERENCE_POSE, source, {
        render: { joint: renders('joint', pick, pick, t) },
        ground: { joint: [{ partId: pick.partId, materialRole: pick.materialRole }] },
      });
      assert.ok(parts.every((p) => p.matrix.every(Number.isFinite)), `${kind} t=${t} 占位矩阵出现 NaN`);
      assert.ok(Math.abs(headY(parts) - baseline) < 1e-12, `${kind} t=${t} 占位主体被替换效果搬动`);
    }
  }
});
