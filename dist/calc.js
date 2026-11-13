// 临界点 · 纯计算内核
// 不触碰 DOM、不联网、不调用 AI。所有规则由调用方（用户）传入。
// 任何“官方口径”都不内置：示例分值、示例竞争者均为合成数据。

const EPS = 1e-9;

export const SCHEMES = [
  {
    id: 'standard4',
    name: '标准 4.0（90 分档）',
    short: '标准 4.0',
    unit: '4.0',
    bands: [
      [90, 4.0], [85, 3.7], [80, 3.3], [75, 3.0],
      [70, 2.7], [65, 2.3], [60, 2.0], [0, 0],
    ],
  },
  {
    id: 'improved4',
    name: '改进 4.0（85 分档）',
    short: '改进 4.0',
    unit: '4.0',
    bands: [
      [85, 4.0], [80, 3.7], [75, 3.3], [70, 3.0],
      [65, 2.7], [60, 2.3], [0, 0],
    ],
  },
  {
    id: 'five',
    name: '5.0 制（分数 ÷ 10 − 5）',
    short: '5.0 制',
    unit: '5.0',
    linear: true,
  },
  {
    id: 'hundred',
    name: '百分制加权平均',
    short: '百分制',
    unit: '分',
    hundred: true,
  },
  {
    id: 'custom',
    name: '自定义分段',
    short: '自定义',
    unit: '自定义',
  },
];

export const RETAKE_MODES = [
  { id: 'none', name: '不计重修（用原成绩）' },
  { id: 'highest', name: '取最高' },
  { id: 'latest', name: '取最新（用重修成绩）' },
  { id: 'average', name: '取平均' },
];

export const BONUS_PRESETS = [
  { id: 'nat1', label: '国家级竞赛一等奖', points: 3.0 },
  { id: 'prov1', label: '省级竞赛一等奖', points: 1.5 },
  { id: 'school1', label: '校级竞赛一等奖', points: 0.5 },
  { id: 'paper', label: '核心期刊论文', points: 2.0 },
  { id: 'patent', label: '发明专利', points: 1.5 },
];

export const DEFAULT_CUSTOM_BANDS = [
  { min: 90, gp: 4.0 }, { min: 85, gp: 3.7 }, { min: 80, gp: 3.3 },
  { min: 75, gp: 3.0 }, { min: 70, gp: 2.7 }, { min: 65, gp: 2.3 },
  { min: 60, gp: 2.0 }, { min: 0, gp: 0 },
];

export function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

export function num(v, fallback = 0) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback;
  if (v === '' || v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function getScheme(settings = {}) {
  return SCHEMES.find((s) => s.id === settings.schemeId) || SCHEMES[0];
}

export function normalizeBands(bands) {
  const list = (bands || []).map((b) =>
    Array.isArray(b)
      ? { min: num(b[0]), gp: num(b[1]) }
      : { min: num(b && b.min), gp: num(b && b.gp) }
  );
  return list.sort((a, b) => b.min - a.min);
}

export function bandsFor(settings = {}) {
  const scheme = getScheme(settings);
  if (scheme.id === 'custom') {
    const custom = normalizeBands(settings.customBands);
    return custom.length ? custom : normalizeBands(DEFAULT_CUSTOM_BANDS);
  }
  return normalizeBands(scheme.bands);
}

// 分数 → 绩点（按用户选择的换算口径）
export function gradePoint(score, schemeOrId, bands) {
  const scheme = typeof schemeOrId === 'string'
    ? (SCHEMES.find((s) => s.id === schemeOrId) || SCHEMES[0])
    : (schemeOrId || SCHEMES[0]);
  const s = clamp(num(score), 0, 100);
  if (scheme.hundred) return s;
  if (scheme.linear) return clamp(s / 10 - 5, 0, 5);
  const list = bands && bands.length
    ? normalizeBands(bands)
    : (scheme.id === 'custom' ? normalizeBands(DEFAULT_CUSTOM_BANDS) : normalizeBands(scheme.bands));
  for (const band of list) {
    if (s >= band.min - EPS) return band.gp;
  }
  return 0;
}

// 重修计入方式 → 该课用于计算的分数
export function effectiveScore(course, mode = 'none') {
  if (course && course.override != null && course.override !== '') {
    return clamp(num(course.override), 0, 100);
  }
  const original = clamp(num(course && course.score), 0, 100);
  const hasRetake = course && course.retake != null && course.retake !== '';
  if (!hasRetake || mode === 'none') return original;
  const retake = clamp(num(course.retake), 0, 100);
  if (mode === 'highest') return Math.max(original, retake);
  if (mode === 'latest') return retake;
  if (mode === 'average') return (original + retake) / 2;
  return original;
}

// 全量统计：加权平均、GPA、加分、综合分、名次、名额线、临界差
export function computeStats(state) {
  const s = state || {};
  const settings = s.settings || {};
  const scheme = getScheme(settings);
  const bands = bandsFor(settings);
  const allCourses = Array.isArray(s.courses) ? s.courses : [];
  const courses = allCourses.filter(
    (c) => !settings.onlyRequired || (c && c.kind === 'required')
  );

  let credits = 0;
  let creditGp = 0;
  let creditScore = 0;
  const perCourse = courses.map((c) => {
    const creditsN = Math.max(0, num(c.credits));
    const effective = effectiveScore(c, settings.retakeMode || 'none');
    const gp = gradePoint(effective, scheme, bands);
    credits += creditsN;
    creditGp += creditsN * gp;
    creditScore += creditsN * effective;
    return {
      id: c.id,
      name: c.name || '未命名课程',
      credits: creditsN,
      kind: c.kind || 'required',
      original: clamp(num(c.score), 0, 100),
      effective,
      gp,
    };
  });

  const weightedAverage = credits > 0 ? creditScore / credits : 0;
  const gpa = credits > 0 ? creditGp / credits : 0;

  const bonusRaw = (Array.isArray(s.bonuses) ? s.bonuses : []).reduce(
    (sum, b) => sum + Math.max(0, num(b.points)),
    0
  );
  const cap = settings.bonusCap == null || settings.bonusCap === ''
    ? null
    : Math.max(0, num(settings.bonusCap));
  const bonusTotal = cap == null ? bonusRaw : Math.min(bonusRaw, cap);
  const capApplied = cap != null && bonusRaw > cap + EPS;

  const academicWeight = clamp(num(settings.academicWeight, 100), 0, 100) / 100;
  const bonusWeight = clamp(num(settings.bonusWeight, 100), 0, 100) / 100;
  const composite = weightedAverage * academicWeight + bonusTotal * bonusWeight;

  const cohort = (Array.isArray(s.cohort) ? s.cohort : []).map((p, i) => {
    const academic = clamp(num(p.academic), 0, 100);
    const raw = Math.max(0, num(p.bonus));
    const bonus = cap == null ? raw : Math.min(raw, cap);
    return {
      id: p.id || 'p' + i,
      name: p.name || '竞争者 ' + (i + 1),
      academic,
      bonus,
      composite: academic * academicWeight + bonus * bonusWeight,
    };
  });

  const me = { id: 'me', name: '我', composite, mine: true };
  const sorted = [me, ...cohort].slice().sort((a, b) => b.composite - a.composite);
  const rank = 1 + cohort.filter((p) => p.composite > composite + 1e-9).length;
  const quota = Math.max(1, Math.round(num(settings.quota, 3)));
  const cohortFilled = sorted.length >= quota;
  const cutoff = cohortFilled ? sorted[quota - 1].composite : null;
  const gap = cutoff == null ? null : composite - cutoff;
  const inQuota = cutoff == null ? null : rank <= quota;

  const target = Math.max(0, num(settings.gpaTarget, 0));
  const gpaGap = target > 0 ? target - gpa : null;

  const leverage = perCourse
    .filter((p) => p.credits > 0 && p.effective < 100)
    .map((p) => ({ ...p, headroom: p.credits * (100 - p.effective) }))
    .sort((a, b) => b.headroom - a.headroom)
    .slice(0, 3);

  return {
    schemeId: scheme.id,
    schemeName: scheme.name,
    schemeShort: scheme.short,
    schemeUnit: scheme.unit,
    bands,
    retakeMode: settings.retakeMode || 'none',
    onlyRequired: Boolean(settings.onlyRequired),
    credits,
    courseCount: courses.length,
    perCourse,
    weightedAverage,
    gpa,
    bonusRaw,
    bonusTotal,
    bonusCap: cap,
    bonusCapApplied: capApplied,
    academicWeight: academicWeight * 100,
    bonusWeight: bonusWeight * 100,
    composite,
    cohort,
    cohortSize: cohort.length,
    cohortFilled,
    rank,
    quota,
    cutoff,
    gap,
    inQuota,
    target,
    gpaGap,
    leverage,
  };
}

// —— 假设推演 ——

// 单科假设：override 只影响这次计算，不写回状态
export function withCourseScore(state, courseId, score) {
  return {
    ...state,
    courses: (state.courses || []).map((c) =>
      c.id === courseId ? { ...c, override: clamp(num(score), 0, 100) } : c
    ),
  };
}

// 全部课程统一提分（只计当前计入范围内的课程）
export function withAllDelta(state, delta) {
  const base = computeStats(state);
  const map = new Map(base.perCourse.map((p) => [p.id, p.effective]));
  return {
    ...state,
    courses: (state.courses || []).map((c) =>
      map.has(c.id) ? { ...c, override: clamp(map.get(c.id) + num(delta), 0, 100) } : c
    ),
  };
}

// 清掉临时假设，返回原状态
export function clearOverrides(state) {
  return {
    ...state,
    courses: (state.courses || []).map(({ override, ...rest }) => rest),
  };
}

// 目标 GPA 反解：全科平均再提多少分（0.1 精度，封顶 100 分）
export function uniformDeltaForGpa(state, target) {
  const base = computeStats(state);
  if (!(target > 0) || base.courseCount === 0) return null;
  if (base.gpa >= target - 1e-9) return 0;
  for (let d = 1; d <= 1000; d += 1) {
    const delta = d / 10;
    if (computeStats(withAllDelta(state, delta)).gpa >= target - 1e-9) {
      return delta;
    }
  }
  return null;
}

// 加分敏感性：再加一个示例奖项，名次会怎么变
export function bonusSensitivity(state, presets = BONUS_PRESETS) {
  const base = computeStats(state);
  return presets.map((preset) => {
    const next = computeStats({
      ...state,
      bonuses: [
        ...(state.bonuses || []),
        { id: 'sim-' + preset.id, name: preset.label, points: preset.points },
      ],
    });
    return {
      id: preset.id,
      label: preset.label,
      points: preset.points,
      composite: next.composite,
      rank: next.rank,
      rankDelta: base.rank - next.rank,
      inQuota: next.inQuota,
      gap: next.gap,
      bonusTotal: next.bonusTotal,
      capBlocked: next.bonusCapApplied ? next.bonusTotal - base.bonusTotal < preset.points - EPS : false,
    };
  });
}

// 只靠加分进名额，还差多少加分分（考虑上限与权重）
export function requiredBonusPoints(state) {
  const base = computeStats(state);
  if (base.cutoff == null) return { needed: null, reason: 'no-cutoff' };
  if (base.rank <= base.quota) {
    return { needed: 0, reason: 'already-in', headroom: null };
  }
  if (base.bonusWeight <= 0) {
    return { needed: null, reason: 'no-bonus-weight' };
  }
  const needComposite = Math.max(0, base.cutoff - base.composite);
  const needed = needComposite / (base.bonusWeight / 100);
  const headroom = base.bonusCap == null ? null : Math.max(0, base.bonusCap - base.bonusTotal);
  return {
    needed,
    reason: headroom != null && needed > headroom + 1e-9 ? 'cap-limited' : 'ok',
    headroom,
  };
}

export const __internals = { EPS };
