import test from 'node:test';
import assert from 'node:assert/strict';
import {
  gradePoint,
  effectiveScore,
  computeStats,
  withCourseScore,
  withAllDelta,
  uniformDeltaForGpa,
  requiredBonusPoints,
  bonusSensitivity,
  bandsFor,
  DEFAULT_CUSTOM_BANDS,
} from '../dist/calc.js';

const close = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps;

function baseState(over = {}) {
  return {
    courses: [
      { id: 'c1', name: '数据结构', credits: 4, score: 90, kind: 'required' },
      { id: 'c2', name: '大学英语', credits: 2, score: 80, kind: 'required' },
    ],
    bonuses: [],
    cohort: [],
    settings: {
      schemeId: 'standard4',
      retakeMode: 'none',
      onlyRequired: false,
      academicWeight: 100,
      bonusWeight: 100,
      bonusCap: null,
      gpaTarget: 0,
      quota: 3,
    },
    ...over,
  };
}

test('标准 4.0 分段边界', () => {
  assert.equal(gradePoint(90, 'standard4'), 4.0);
  assert.equal(gradePoint(89.9, 'standard4'), 3.7);
  assert.equal(gradePoint(85, 'standard4'), 3.7);
  assert.equal(gradePoint(84.9, 'standard4'), 3.3);
  assert.equal(gradePoint(60, 'standard4'), 2.0);
  assert.equal(gradePoint(59.9, 'standard4'), 0);
  assert.equal(gradePoint(0, 'standard4'), 0);
});

test('改进 4.0 与 5.0 制换算', () => {
  assert.equal(gradePoint(85, 'improved4'), 4.0);
  assert.equal(gradePoint(84.9, 'improved4'), 3.7);
  assert.equal(gradePoint(90, 'five'), 4.0);
  assert.equal(gradePoint(100, 'five'), 5.0);
  assert.equal(gradePoint(49, 'five'), 0);
  assert.equal(gradePoint(120, 'five'), 5.0);
  assert.equal(gradePoint(88, 'hundred'), 88);
});

test('自定义分段优先于预设', () => {
  const bands = [{ min: 80, gp: 3.0 }, { min: 0, gp: 0 }];
  assert.equal(gradePoint(85, 'custom', bands), 3.0);
  assert.equal(gradePoint(79, 'custom', bands), 0);
  const st = baseState({ settings: { ...baseState().settings, schemeId: 'custom', customBands: bands } });
  assert.equal(computeStats(st).gpa, 3.0);
  assert.equal(bandsFor({ schemeId: 'custom', customBands: [] })[0].min, 90);
  assert.equal(DEFAULT_CUSTOM_BANDS.length, 8);
});

test('重修四种计入方式', () => {
  const c = { id: 'x', credits: 3, score: 80, retake: 92 };
  assert.equal(effectiveScore(c, 'none'), 80);
  assert.equal(effectiveScore(c, 'highest'), 92);
  assert.equal(effectiveScore(c, 'latest'), 92);
  assert.equal(effectiveScore(c, 'average'), 86);
  assert.equal(effectiveScore({ id: 'y', credits: 3, score: 80 }, 'latest'), 80);
  // 重修比原来低：取最高仍是原分，取最新则下降
  const d = { id: 'z', credits: 3, score: 90, retake: 75 };
  assert.equal(effectiveScore(d, 'highest'), 90);
  assert.equal(effectiveScore(d, 'latest'), 75);
});

test('加权平均与 GPA 学分加权', () => {
  const s = computeStats(baseState());
  assert.ok(close(s.weightedAverage, 86.6666667));
  assert.ok(close(s.gpa, (4.0 * 4 + 3.3 * 2) / 6));
  assert.equal(s.credits, 6);
  assert.equal(s.courseCount, 2);
});

test('只计必修时排除选修', () => {
  const st = baseState({
    courses: [
      { id: 'a', credits: 4, score: 90, kind: 'required' },
      { id: 'b', credits: 10, score: 60, kind: 'elective' },
    ],
    settings: { ...baseState().settings, onlyRequired: true },
  });
  const s = computeStats(st);
  assert.equal(s.credits, 4);
  assert.ok(close(s.weightedAverage, 90));
});

test('加分上限与综合分权重', () => {
  const st = baseState({
    bonuses: [{ id: '1', points: 3 }, { id: '2', points: 2 }],
    settings: { ...baseState().settings, bonusCap: 4, academicWeight: 85, bonusWeight: 15 },
  });
  const s = computeStats(st);
  assert.equal(s.bonusRaw, 5);
  assert.equal(s.bonusTotal, 4);
  assert.ok(s.bonusCapApplied);
  assert.ok(close(s.composite, 86.6666667 * 0.85 + 4 * 0.15, 1e-5));
});

test('名次、名额线与临界差', () => {
  const st = baseState({
    cohort: [
      { id: 'p1', name: 'A', academic: 92, bonus: 0 },
      { id: 'p2', name: 'B', academic: 88, bonus: 0 },
      { id: 'p3', name: 'C', academic: 85, bonus: 0 },
    ],
    settings: { ...baseState().settings, quota: 2 },
  });
  const s = computeStats(st);
  assert.equal(s.rank, 3);
  assert.ok(close(s.cutoff, 88));
  assert.ok(close(s.gap, 86.6666667 - 88, 1e-5));
  assert.equal(s.inQuota, false);

  const st2 = baseState({
    cohort: [
      { id: 'p1', academic: 92, bonus: 0 },
      { id: 'p2', academic: 88, bonus: 0 },
      { id: 'p3', academic: 85, bonus: 0 },
    ],
    settings: { ...baseState().settings, quota: 2, academicWeight: 100, bonusWeight: 0 },
  });
  st2.courses[0].score = 86; // 加权平均 84
  const s2 = computeStats(st2);
  assert.equal(s2.rank, 4);
  assert.ok(close(s2.cutoff, 88));
  assert.ok(close(s2.gap, -4));
  assert.equal(s2.inQuota, false);
});

test('同分同名次（不严格超过）', () => {
  const st = baseState({
    cohort: [{ id: 'p1', academic: 520 / 6, bonus: 0 }],
    settings: { ...baseState().settings, quota: 1 },
  });
  const s = computeStats(st);
  assert.equal(s.rank, 1);
  assert.ok(Math.abs(s.gap) <= 1e-5);
  assert.equal(s.inQuota, true);
});

test('竞争者不足名额时不给名额线', () => {
  const st = baseState({
    cohort: [{ id: 'p1', academic: 92, bonus: 0 }],
    settings: { ...baseState().settings, quota: 5 },
  });
  const s = computeStats(st);
  assert.equal(s.cohortFilled, false);
  assert.equal(s.cutoff, null);
  assert.equal(s.gap, null);
  assert.equal(s.inQuota, null);
});

test('单科假设不写回原状态', () => {
  const st = baseState();
  const before = computeStats(st).gpa;
  const sim = computeStats(withCourseScore(st, 'c2', 90));
  assert.ok(sim.gpa > before);
  assert.equal(computeStats(st).gpa, before);
});

test('全科提分 10 分', () => {
  const st = baseState();
  const sim = computeStats(withAllDelta(st, 10));
  assert.ok(close(sim.weightedAverage, 96.6666667, 1e-5));
  assert.equal(sim.gpa, 4.0);
  // 封顶 100
  const capped = computeStats(withAllDelta(st, 50));
  assert.equal(capped.weightedAverage, 100);
});

test('反解目标 GPA 的提分幅度', () => {
  const st = baseState();
  const base = computeStats(st).gpa;
  const target = Math.min(4.0, base + 0.2);
  const delta = uniformDeltaForGpa(st, target);
  assert.ok(delta > 0);
  assert.ok(computeStats(withAllDelta(st, delta)).gpa >= target - 1e-9);
  if (delta > 0.1) {
    assert.ok(computeStats(withAllDelta(st, delta - 0.1)).gpa < target);
  }
  assert.equal(uniformDeltaForGpa(st, base - 0.1), 0);
});

test('靠加分进名额的反解与上限', () => {
  const st = baseState({
    cohort: [
      { id: 'p1', academic: 92, bonus: 0 },
      { id: 'p2', academic: 88, bonus: 0 },
      { id: 'p3', academic: 85, bonus: 0 },
    ],
    settings: { ...baseState().settings, quota: 2 },
  });
  const s = computeStats(st);
  const need = requiredBonusPoints(st);
  assert.ok(close(need.needed, 88 - s.composite, 1e-6));
  assert.equal(need.reason, 'ok');

  const weighted = baseState({
    ...st,
    settings: { ...st.settings, academicWeight: 85, bonusWeight: 15 },
  });
  const need2 = requiredBonusPoints(weighted);
  const s2 = computeStats(weighted);
  assert.ok(close(need2.needed, (s2.cutoff - s2.composite) / 0.15, 1e-5));

  const capped = baseState({
    ...st,
    bonuses: [{ id: 'b', points: 1 }],
    settings: { ...st.settings, bonusCap: 1, quota: 2 },
  });
  assert.equal(requiredBonusPoints(capped).reason, 'cap-limited');

  const noWeight = baseState({
    ...st,
    settings: { ...st.settings, bonusWeight: 0 },
  });
  assert.equal(requiredBonusPoints(noWeight).reason, 'no-bonus-weight');
});

test('加分敏感性：省一带来名次变化', () => {
  const st = baseState({
    cohort: [
      { id: 'p1', academic: 87.5, bonus: 0 },
      { id: 'p2', academic: 85, bonus: 0 },
    ],
    settings: { ...baseState().settings, quota: 2 },
  });
  const base = computeStats(st);
  const rows = bonusSensitivity(st);
  const prov = rows.find((r) => r.id === 'prov1');
  assert.equal(base.rank, 2);
  assert.equal(prov.rank, 1);
  assert.equal(prov.rankDelta, 1);
  const nat = rows.find((r) => r.id === 'nat1');
  assert.ok(nat.composite > base.composite);
  assert.ok(close(nat.composite - base.composite, 3, 1e-6));
});

test('空数据不产生 NaN', () => {
  const st = { courses: [], bonuses: [], cohort: [], settings: { schemeId: 'standard4', quota: 3 } };
  const s = computeStats(st);
  assert.equal(s.gpa, 0);
  assert.equal(s.weightedAverage, 0);
  assert.equal(s.composite, 0);
  assert.equal(Number.isNaN(s.gap), false);
  assert.equal(s.cutoff, null);
});
