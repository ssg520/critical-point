import {
  computeStats,
  withCourseScore,
  withAllDelta,
  uniformDeltaForGpa,
  requiredBonusPoints,
  bonusSensitivity,
  effectiveScore,
  bandsFor,
  SCHEMES,
  RETAKE_MODES,
  BONUS_PRESETS,
  DEFAULT_CUSTOM_BANDS,
  num,
  clamp,
} from './calc.js';

const STORE_KEY = 'critical-point.v1';
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const fmt = (n, d = 2) => (Number.isFinite(n) ? n.toFixed(d) : '—');
const uid = (p = 'id') => p + Math.random().toString(36).slice(2, 8);
const deep = (v) => JSON.parse(JSON.stringify(v));
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]));

function directWeights(s) {
  return Math.round(s.academicWeight) === 100 && Math.round(s.bonusWeight) === 100;
}

function weightLabel(s) {
  return directWeights(s)
    ? '加分直接计入'
    : `学业 ×${Math.round(s.academicWeight)}% · 加分 ×${Math.round(s.bonusWeight)}%`;
}

function weightEquation(s) {
  if (directWeights(s)) {
    return `综合分 = <b>${fmt(s.weightedAverage, 2)}</b> + <b>${fmt(s.bonusTotal, 1)}</b>（默认直接相加）`;
  }
  return `综合分 = <b>${fmt(s.weightedAverage, 2)}</b> × ${Math.round(s.academicWeight)}% + <b>${fmt(s.bonusTotal, 1)}</b> × ${Math.round(s.bonusWeight)}%`;
}

// ---------- 数据 ----------

function defaultSettings() {
  return {
    schemeId: 'standard4',
    customBands: deep(DEFAULT_CUSTOM_BANDS),
    retakeMode: 'none',
    onlyRequired: false,
    academicWeight: 100,
    bonusWeight: 100,
    bonusCap: null,
    gpaTarget: 3.8,
    quota: 3,
  };
}

function sampleState() {
  return {
    courses: [
      { id: 'c1', name: '数据结构', credits: 4, score: 88, kind: 'required', retake: null },
      { id: 'c2', name: '数据库原理', credits: 3, score: 91, kind: 'required', retake: null },
      { id: 'c3', name: '概率论与数理统计', credits: 3.5, score: 84, kind: 'required', retake: null },
      { id: 'c4', name: '机器学习导论', credits: 3, score: 93, kind: 'required', retake: null },
      { id: 'c5', name: '操作系统', credits: 3.5, score: 79, kind: 'required', retake: null },
      { id: 'c6', name: '大学英语（四）', credits: 2, score: 86, kind: 'required', retake: null },
      { id: 'c7', name: '马克思主义基本原理', credits: 2, score: 90, kind: 'required', retake: null },
      { id: 'c8', name: '数据可视化', credits: 2.5, score: 89, kind: 'elective', retake: null },
      { id: 'c9', name: '计算机网络', credits: 3, score: 82, kind: 'required', retake: null },
      { id: 'c10', name: '体育（四）', credits: 1, score: 85, kind: 'elective', retake: null },
    ],
    bonuses: [
      { id: 'b1', name: '省级程序设计竞赛一等奖', points: 1.5 },
      { id: 'b2', name: '校级大创结题', points: 0.5 },
      { id: 'b3', name: '学生工作满一年', points: 0.3 },
    ],
    cohort: [
      { id: 'p1', name: '同学 A', academic: 92.0, bonus: 3.0 },
      { id: 'p2', name: '同学 B', academic: 90.5, bonus: 1.5 },
      { id: 'p3', name: '同学 C', academic: 89.2, bonus: 2.0 },
      { id: 'p4', name: '同学 D', academic: 88.8, bonus: 0.5 },
      { id: 'p5', name: '同学 E', academic: 87.4, bonus: 1.0 },
      { id: 'p6', name: '同学 F', academic: 86.0, bonus: 2.5 },
    ],
    settings: defaultSettings(),
  };
}

function normalizeState(raw) {
  const s = deep(raw);
  s.settings = { ...defaultSettings(), ...(s.settings || {}) };
  if (!Array.isArray(s.settings.customBands) || !s.settings.customBands.length) {
    s.settings.customBands = deep(DEFAULT_CUSTOM_BANDS);
  }
  s.courses = (s.courses || []).map((c) => ({
    id: c.id || uid('c'),
    name: c.name || '未命名课程',
    credits: Math.max(0, num(c.credits, 0)),
    score: clamp(num(c.score, 0), 0, 100),
    kind: c.kind === 'elective' ? 'elective' : 'required',
    retake: c.retake == null || c.retake === '' ? null : clamp(num(c.retake, 0), 0, 100),
  }));
  s.bonuses = (s.bonuses || []).map((b) => ({
    id: b.id || uid('b'),
    name: b.name || '加分项',
    points: Math.max(0, num(b.points, 0)),
  }));
  s.cohort = (s.cohort || []).map((p) => ({
    id: p.id || uid('p'),
    name: p.name || '竞争者',
    academic: clamp(num(p.academic, 0), 0, 100),
    bonus: Math.max(0, num(p.bonus, 0)),
  }));
  return s;
}

function makeScenario(label, st) {
  return {
    id: uid('sc'),
    label,
    gpa: st.gpa,
    wavg: st.weightedAverage,
    composite: st.composite,
    rank: st.rank,
    quota: st.quota,
    total: st.cohortSize + 1,
    gap: st.gap,
    at: Date.now(),
  };
}

function seedScenarios(sample) {
  const a = makeScenario('示例 A · 保持现状', computeStats(sample));
  const v = deep(sample);
  v.courses.find((c) => c.id === 'c1').score = 93;
  v.courses.find((c) => c.id === 'c5').score = 85;
  const b = makeScenario('示例 B · 刷两门重修', computeStats(v));
  return [a, b];
}

function loadStore() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !data.state || !Array.isArray(data.state.courses)) return null;
    return data;
  } catch {
    return null;
  }
}

const stored = loadStore();
const initialSample = stored ? null : sampleState();
let state = stored ? normalizeState(stored.state) : initialSample;
let scenarios = stored && Array.isArray(stored.scenarios) ? stored.scenarios : seedScenarios(initialSample);
let selectedCourseId = state.courses[0] ? state.courses[0].id : null;
let simScore = null;
let allDelta = 0;
let activeTab = 'course';
let saveTimer = null;
let toastTimer = null;

// ---------- 提示与保存 ----------

function setSaveState(text) {
  const el = $('#saveState');
  if (el) el.textContent = text;
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({ v: 1, state, scenarios, savedAt: Date.now() }));
      const t = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      setSaveState('已保存 · ' + t);
    } catch {
      setSaveState('本机存储不可用');
    }
  }, 350);
}

function toast(msg, isError = false) {
  const el = $('#toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('err', isError);
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}

// ---------- 渲染 ----------

function setTab(name) {
  activeTab = name;
  $$('.tab').forEach((t) => {
    const on = t.dataset.tab === name;
    t.setAttribute('aria-selected', on ? 'true' : 'false');
    t.tabIndex = on ? 0 : -1;
  });
  $$('.pane').forEach((p) => { p.hidden = p.dataset.pane !== name; });
}

function renderMetrics() {
  const s = computeStats(state);
  $('#mWavg').textContent = fmt(s.weightedAverage, 2);
  $('#mCredits').textContent = fmt(s.credits, s.credits % 1 ? 1 : 0);
  $('#mWavgSub').textContent = s.courseCount
    ? `${s.courseCount} 门课计分 · ${s.onlyRequired ? '只计必修' : '含选修'}`
    : '还没有课程，去「课程成绩」添加';

  $('#mScheme').textContent = s.schemeShort;
  const isHundred = s.schemeId === 'hundred';
  $('#mGpa').textContent = fmt(s.gpa, 2);
  $('#mGpaUnit').textContent = isHundred ? '分' : `/ ${s.schemeUnit}`;
  if (s.target > 0) {
    const diff = s.gpaGap;
    $('#mGpaSub').textContent = diff > 0.005
      ? `目标 ${fmt(s.target, 2)} · 还差 ${fmt(diff, 2)}`
      : `目标 ${fmt(s.target, 2)} · 已达标 ${fmt(-diff, 2)}`;
    $('#mGpaBar').style.width = clamp((s.gpa / s.target) * 100, 0, 100).toFixed(1) + '%';
  } else {
    $('#mGpaSub').textContent = '未设置目标，可在「规则口径」里填';
    $('#mGpaBar').style.width = clamp((s.gpa / 4) * 100, 0, 100).toFixed(1) + '%';
  }

  $('#mWeights').textContent = weightLabel(s);
  $('#mComposite').textContent = fmt(s.composite, 2);
  $('#mCompositeSub').textContent = `加分合计 ${fmt(s.bonusTotal, 1)}`
    + (s.bonusCap != null ? ` / 上限 ${fmt(s.bonusCap, 1)}` : '')
    + (s.bonusCapApplied ? ' · 已触顶' : '');
}

function renderVerdict() {
  const s = computeStats(state);
  $('#vRank').textContent = s.rank;
  $('#vSize').textContent = s.cohortSize + 1;
  $('#vQuota').textContent = s.quota;

  if (s.cutoff == null) {
    $('#vLine').textContent = `竞争者不足：至少录入 ${Math.max(0, s.quota - 1)} 位竞争者才能画名额线`;
    $('#vGap').textContent = '—';
    $('#vGap').className = 'verdict-gap';
    $('#vGapSub').textContent = `当前只录了 ${s.cohortSize} 位竞争者，名额 ${s.quota}`;
    $('#vTrack').classList.add('hide');
    return;
  }

  $('#vTrack').classList.remove('hide');
  const gap = s.gap;
  $('#vLine').textContent = `名额线 ${fmt(s.cutoff, 2)} 分（第 ${s.quota} 名）· ${s.inQuota ? '你在名额内' : '你在名额线外'}`;
  $('#vGap').textContent = gap >= 0 ? `领先 ${fmt(gap, 2)} 分` : `还差 ${fmt(-gap, 2)} 分`;
  $('#vGap').className = 'verdict-gap ' + (gap >= 0 ? 'pos' : 'neg');
  $('#vGapSub').textContent = s.inQuota ? '按当前规则可进名额' : '按当前规则暂未进名额';

  const values = [s.composite, s.cutoff, ...s.cohort.map((p) => p.composite)];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max((hi - lo) * 0.18, 0.5);
  const min = lo - pad;
  const max = hi + pad;
  const span = max - min || 1;
  const pos = (v) => (clamp((v - min) / span, 0, 1) * 100).toFixed(2) + '%';
  $('#vCut').style.left = pos(s.cutoff);
  $('#vMe').style.left = pos(s.composite);
  $('#vMin').textContent = fmt(min, 1);
  $('#vMax').textContent = fmt(max, 1);
  $('#vMe').title = `我：${fmt(s.composite, 2)} 分`;
  $('#vCut').title = `名额线：${fmt(s.cutoff, 2)} 分`;
}

function renderCoursePane() {
  const s = computeStats(state);
  const retakeOff = state.settings.retakeMode === 'none';
  const rows = state.courses.map((c) => `
    <tr data-id="${c.id}">
      <td><input class="cell name" data-scope="course" data-field="name" value="${esc(c.name)}" aria-label="课程名"></td>
      <td class="num"><input class="cell num" type="number" min="0" max="20" step="0.5" data-scope="course" data-field="credits" value="${c.credits}" aria-label="学分"></td>
      <td>
        <select class="cell" data-scope="course" data-field="kind" aria-label="课程类型">
          <option value="required"${c.kind !== 'elective' ? ' selected' : ''}>必修</option>
          <option value="elective"${c.kind === 'elective' ? ' selected' : ''}>选修</option>
        </select>
      </td>
      <td class="num"><input class="cell num" type="number" min="0" max="100" step="1" data-scope="course" data-field="score" value="${c.score}" aria-label="成绩"></td>
      <td class="num retake-col${retakeOff ? ' is-off' : ''}"><input class="cell num" type="number" min="0" max="100" step="1" data-scope="course" data-field="retake" value="${c.retake ?? ''}" placeholder="—" aria-label="重修成绩"${retakeOff ? ' title="先在规则口径里选择重修计入方式"' : ''}></td>
      <td><button class="icon-btn" type="button" data-del="course" data-id="${c.id}" aria-label="删除 ${esc(c.name)}">×</button></td>
    </tr>`).join('');

  $('#pane-course').innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr><th>课程</th><th class="num">学分</th><th>类型</th><th class="num">成绩</th><th class="num">重修</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" class="empty">还没有课程。点下面添加，或从右上角「重置示例」恢复合成数据。</td></tr>'}</tbody>
      </table>
    </div>
    <div class="table-foot">
      <span>计入学分 <b>${fmt(s.credits, s.credits % 1 ? 1 : 0)}</b> · 计分课程 <b>${s.courseCount}</b></span>
      <span>${state.settings.onlyRequired ? '只计必修' : '含选修'}</span>
    </div>
    <button class="add-row" type="button" data-add="course">+ 添加课程</button>
    <p class="pane-note">重修列要先在「规则口径」里选计入方式（取最高 / 取最新 / 取平均）才会生效；只计必修也在那里切换。窄屏下表格可左右滑动。</p>`;
}

function renderBonusPane() {
  const s = computeStats(state);
  const rows = state.bonuses.map((b) => `
    <tr data-id="${b.id}">
      <td><input class="cell name" data-scope="bonus" data-field="name" value="${esc(b.name)}" aria-label="加分名称"></td>
      <td class="num"><input class="cell num" type="number" min="0" max="20" step="0.1" data-scope="bonus" data-field="points" value="${b.points}" aria-label="加分分值"></td>
      <td><button class="icon-btn" type="button" data-del="bonus" data-id="${b.id}" aria-label="删除 ${esc(b.name)}">×</button></td>
    </tr>`).join('');
  const presets = BONUS_PRESETS.map((p) => `<button class="preset" type="button" data-preset="${p.id}">${esc(p.label)} +${p.points}</button>`).join('');

  $('#pane-bonus').innerHTML = `
    <p class="pane-note" style="margin:0 0 8px">分值与上限都由你填写；下面是示例奖项，点一下加入，再改成你学校的口径。</p>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>加分项</th><th class="num">分值</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="3" class="empty">还没有加分项。</td></tr>'}</tbody>
    </table></div>
    <div class="table-foot">
      <span>加分合计 <b>${fmt(s.bonusTotal, 1)}</b>${s.bonusCap != null ? ` · 上限 ${fmt(s.bonusCap, 1)}` : ''}</span>
      ${s.bonusCapApplied ? '<span class="badge gold">已触顶</span>' : ''}
    </div>
    <div class="preset-row">${presets}</div>
    <button class="add-row" type="button" data-add="bonus">+ 添加加分项</button>`;
}

function renderCohortPane() {
  const s = computeStats(state);
  const rows = s.cohort.map((p) => `
    <tr data-id="${p.id}">
      <td><input class="cell name" data-scope="cohort" data-field="name" value="${esc(p.name)}" aria-label="竞争者代号"></td>
      <td class="num"><input class="cell num" type="number" min="0" max="100" step="0.1" data-scope="cohort" data-field="academic" value="${p.academic}" aria-label="竞争者加权平均分"></td>
      <td class="num"><input class="cell num" type="number" min="0" max="20" step="0.1" data-scope="cohort" data-field="bonus" value="${p.bonus}" aria-label="竞争者加分"></td>
      <td class="num composite-cell">${fmt(p.composite, 2)}</td>
      <td><button class="icon-btn" type="button" data-del="cohort" data-id="${p.id}" aria-label="删除 ${esc(p.name)}">×</button></td>
    </tr>`).join('');

  $('#pane-cohort').innerHTML = `
    <p class="pane-note" style="margin:0 0 8px">名次只基于你录入的竞争者。示例为合成人物，不对应任何真实学生。</p>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>代号</th><th class="num">加权平均</th><th class="num">加分</th><th class="num">综合分</th><th></th></tr></thead>
      <tbody>
        <tr class="row-me">
          <td>我<span class="me-tag">本机</span></td>
          <td class="num">${fmt(s.weightedAverage, 2)}</td>
          <td class="num">${fmt(s.bonusTotal, 1)}</td>
          <td class="num composite-cell">${fmt(s.composite, 2)}</td>
          <td></td>
        </tr>
        ${rows || `<tr><td colspan="5" class="empty">还没有竞争者。至少录入 ${Math.max(0, s.quota - 1)} 位才能画出名额线。</td></tr>`}
      </tbody>
    </table></div>
    <div class="table-foot"><span>我的名次 <b>第 ${s.rank}</b> / ${s.cohortSize + 1}</span><span>名额 <b>${s.quota}</b></span></div>
    <button class="add-row" type="button" data-add="cohort">+ 添加竞争者</button>
    <button class="add-row" type="button" data-fill="cohort">用示例竞争者填满（合成数据）</button>`;
}

function renderRulesPane() {
  const st = state.settings;
  const s = computeStats(state);
  const bands = bandsFor(st);

  const schemes = SCHEMES.map((x) => `
    <label class="scheme">
      <input type="radio" name="gpaScheme" value="${x.id}"${x.id === st.schemeId ? ' checked' : ''}>
      <span><span class="scheme-name">${x.name}</span><small>${x.id === 'custom' ? '自己填分段表' : '常见口径示例'}</small></span>
    </label>`).join('');

  const bandChips = bands.map((b) => `<span class="band">≥${b.min} → ${fmt(b.gp, 2)}</span>`).join('');

  const customEditor = st.schemeId === 'custom' ? `
    <div class="band-edit">
      ${st.customBands.map((b, i) => `
        <div class="band-edit-row">
          <input type="number" min="0" max="100" step="1" value="${b.min}" data-scope="band" data-field="min" data-index="${i}" placeholder="最低分" aria-label="分段最低分">
          <input type="number" min="0" max="5" step="0.1" value="${b.gp}" data-scope="band" data-field="gp" data-index="${i}" placeholder="绩点" aria-label="该分段绩点">
          <button class="icon-btn" type="button" data-del="band" data-index="${i}" aria-label="删除分段">×</button>
        </div>`).join('')}
      <button class="add-row" type="button" data-add="band">+ 添加分段</button>
    </div>` : '';

  const retakeOptions = RETAKE_MODES.map((m) => `<option value="${m.id}"${m.id === st.retakeMode ? ' selected' : ''}>${m.name}</option>`).join('');

  $('#pane-rules').innerHTML = `
    <div class="rule-block">
      <h3>GPA 口径</h3>
      <p class="rule-help">各校换算不同，这里只是常见示例；以本校教务文件为准。</p>
      <div class="scheme-grid">${schemes}</div>
      <div class="band-preview">${bandChips}</div>
      ${customEditor}
    </div>

    <div class="rule-block">
      <h3>重修与计分范围</h3>
      <div class="inline-fields">
        <label class="field">重修计入方式
          <select data-scope="settings" data-field="retakeMode">${retakeOptions}</select>
        </label>
        <span></span>
      </div>
      <label class="check" style="margin-top:10px">
        <input type="checkbox" data-scope="settings" data-field="onlyRequired"${st.onlyRequired ? ' checked' : ''}>
        只计必修课
      </label>
    </div>

    <div class="rule-block">
      <h3>综合分权重</h3>
      <p class="rule-help">综合分 = 加权平均分 × 学业权重 + 加分合计 × 加分权重。默认直接相加。</p>
      <div class="weights-row">
        <label class="field">学业权重（%）
          <input type="number" min="0" max="100" step="1" value="${st.academicWeight}" data-scope="settings" data-field="academicWeight">
        </label>
        <label class="field">加分权重（%）
          <input type="number" min="0" max="100" step="1" value="${st.bonusWeight}" data-scope="settings" data-field="bonusWeight">
        </label>
      </div>
      <div class="presets">
        <button class="preset" type="button" data-weights="100,100">直接相加 100 / 100</button>
        <button class="preset" type="button" data-weights="85,15">85 / 15</button>
        <button class="preset" type="button" data-weights="90,10">90 / 10</button>
      </div>
      <p class="weight-eq">${weightEquation(s)}</p>
    </div>

    <div class="rule-block">
      <h3>目标与名额</h3>
      <div class="inline-fields">
        <label class="field">目标 GPA / 分数
          <input type="number" min="0" max="100" step="0.05" value="${st.gpaTarget}" data-scope="settings" data-field="gpaTarget">
        </label>
        <label class="field">推免名额（人）
          <input type="number" min="1" max="999" step="1" value="${st.quota}" data-scope="settings" data-field="quota">
        </label>
        <label class="field">加分上限（留空 = 不限）
          <input type="number" min="0" max="50" step="0.5" value="${st.bonusCap ?? ''}" data-scope="settings" data-field="bonusCap" placeholder="不限">
        </label>
      </div>
      <p class="pane-note">目标按当前口径填：4.0 制填 3.6 左右，百分制填 90 左右。</p>
    </div>

    <p class="pane-note">以上全部是模拟参数，不是官方规则。请对照本校推免文件填写，本工具不提供任何认定结论。</p>`;
}

function renderChips() {
  const box = $('#courseChips');
  if (!state.courses.length) {
    box.innerHTML = '<span class="empty">还没有课程</span>';
    return;
  }
  box.innerHTML = state.courses.map((c) => `
    <button class="chip" type="button" data-chip="${c.id}" aria-pressed="${c.id === selectedCourseId}">
      <b>${esc(c.name)}</b><small>${c.credits} 学分</small>
    </button>`).join('');
}

function selectedCourse() {
  return state.courses.find((c) => c.id === selectedCourseId) || state.courses[0] || null;
}

function renderSandbox() {
  const c = selectedCourse();
  if (!c) {
    $('#sliderCourseName').textContent = '先添加课程';
    $('#scoreSlider').disabled = true;
    $('#applyScore').disabled = true;
    $('#scoreOut').textContent = '—';
    $('#scoreDeltas').innerHTML = '';
    $('#allDeltas').innerHTML = '';
    $('#solveHints').innerHTML = '<p class="solve-line">还没有课程，先去左边添加。</p>';
    return;
  }
  $('#scoreSlider').disabled = false;
  $('#applyScore').disabled = false;
  selectedCourseId = c.id;
  const eff = effectiveScore(c, state.settings.retakeMode);
  const val = simScore == null ? Math.round(eff) : simScore;
  $('#sliderCourseName').textContent = `${c.name}（${c.credits} 学分）`;
  $('#scoreSlider').value = String(clamp(Math.round(val), 0, 100));
  $('#scoreOut').textContent = $('#scoreSlider').value;
  $('#applyScore').textContent = state.settings.retakeMode === 'none' ? '写入实际成绩' : '写入重修成绩';
  renderScoreDeltas();
  renderAllDeltas();
  renderSolveHints();
}

function deltaCard(label, current, next, digits, suffix = '') {
  const d = next - current;
  const cls = d > 1e-6 ? 'pos' : d < -1e-6 ? 'neg' : '';
  const txt = Math.abs(d) < 1e-6 ? '不变' : (d > 0 ? '+' : '') + fmt(d, digits) + suffix;
  return `<div class="delta">
    <span class="d-label">${label} · 现在 ${fmt(current, digits)}${suffix}</span>
    <span class="d-value"><b>${fmt(next, digits)}${suffix}</b><span class="d-delta ${cls}">${txt}</span></span>
  </div>`;
}

function rankCard(current, next) {
  const d = current - next;
  const cls = d > 0 ? 'pos' : d < 0 ? 'neg' : '';
  const txt = d === 0 ? '不变' : d > 0 ? `前进 ${d}` : `后退 ${-d}`;
  return `<div class="delta">
    <span class="d-label">名次 · 现在 第 ${current}</span>
    <span class="d-value"><b>第 ${next}</b><span class="d-delta ${cls}">${txt}</span></span>
  </div>`;
}

function renderScoreDeltas() {
  const c = selectedCourse();
  if (!c) return;
  const val = Number($('#scoreSlider').value);
  const base = computeStats(state);
  const sim = computeStats(withCourseScore(state, c.id, val));
  $('#scoreDeltas').innerHTML = [
    deltaCard('加权平均分', base.weightedAverage, sim.weightedAverage, 2),
    deltaCard('GPA', base.gpa, sim.gpa, 3),
    deltaCard('综合分', base.composite, sim.composite, 2),
    rankCard(base.rank, sim.rank),
  ].join('');
}

function renderAllDeltas() {
  $('#allOut').textContent = '+' + allDelta;
  if (!state.courses.length) { $('#allDeltas').innerHTML = ''; return; }
  const base = computeStats(state);
  const sim = computeStats(withAllDelta(state, allDelta));
  $('#allDeltas').innerHTML = [
    deltaCard('GPA', base.gpa, sim.gpa, 3),
    deltaCard('综合分', base.composite, sim.composite, 2),
    rankCard(base.rank, sim.rank),
  ].join('');
}

function renderSolveHints() {
  const s = computeStats(state);
  const lines = [];

  if (s.target > 0) {
    const d = uniformDeltaForGpa(state, s.target);
    if (d === 0) {
      lines.push(`<p class="solve-line ok">目标 GPA ${fmt(s.target, 2)} 已达标，现在 ${fmt(s.gpa, 2)}。</p>`);
    } else if (d == null) {
      lines.push(`<p class="solve-line">即使全科都到 100 分，也到不了 ${fmt(s.target, 2)}——检查一下目标或口径。</p>`);
    } else {
      lines.push(`<p class="solve-line">只靠提分：全科平均再提 <b>${fmt(d, 1)}</b> 分，GPA 到 <b>${fmt(s.target, 2)}</b>。</p>`);
    }
  } else {
    lines.push('<p class="solve-line">还没设目标 GPA，去「规则口径」填一个，就能反解要提多少分。</p>');
  }

  const need = requiredBonusPoints(state);
  if (need.reason === 'no-cutoff') {
    lines.push(`<p class="solve-line">竞争者不足 ${s.quota} 人，暂不计算加分缺口。</p>`);
  } else if (need.reason === 'already-in') {
    lines.push(`<p class="solve-line ok">只靠加分：已在名额内，领先 <b>${fmt(s.gap, 2)}</b> 分。</p>`);
  } else if (need.reason === 'no-bonus-weight') {
    lines.push('<p class="solve-line">加分权重是 0，进名额只能靠学业成绩。</p>');
  } else if (need.reason === 'cap-limited') {
    lines.push(`<p class="solve-line">加分已触顶（上限 ${fmt(s.bonusCap, 1)}），仍差 <b>${fmt(need.needed, 2)}</b> 分——只能提成绩。</p>`);
  } else {
    const count = need.needed / 1.5;
    lines.push(`<p class="solve-line">只靠加分：还差 <b>${fmt(need.needed, 2)}</b> 分，约等于 <b>${count <= 1 ? '1 个' : Math.ceil(count) + ' 个'}</b>省一（按 +1.5 示例）。</p>`);
  }

  $('#solveHints').innerHTML = lines.join('');
}

function renderSens() {
  const rows = bonusSensitivity(state);
  $('#sensTable').innerHTML = `
    <thead><tr><th>再加一个</th><th class="num">新名次</th><th class="num">变化</th><th>结果</th></tr></thead>
    <tbody>${rows.map((r) => {
      const ch = r.rankDelta > 0
        ? `<span class="badge pos">↑ ${r.rankDelta}</span>`
        : r.rankDelta < 0
          ? `<span class="badge neg">↓ ${-r.rankDelta}</span>`
          : '<span class="badge">不变</span>';
      const res = r.inQuota == null
        ? '<span class="badge">—</span>'
        : r.inQuota
          ? '<span class="badge pos">过线</span>'
          : `<span class="badge neg">差 ${fmt(Math.abs(r.gap), 2)}</span>`;
      return `<tr><td>${esc(r.label)} <small style="color:var(--site-muted)">+${r.points}</small></td><td class="num">第 ${r.rank}</td><td class="num">${ch}</td><td>${res}</td></tr>`;
    }).join('')}</tbody>`;
}

function renderScenarios() {
  const t = $('#scenTable');
  if (!scenarios.length) {
    t.innerHTML = '<tbody><tr><td class="empty">还没有保存情景。调好参数后点「保存当前」，就能并排比较。</td></tr></tbody>';
    return;
  }
  t.innerHTML = `
    <thead><tr><th>情景</th><th class="num">GPA</th><th class="num">综合分</th><th class="num">名次</th><th></th></tr></thead>
    <tbody>${scenarios.map((sc) => {
      const gap = sc.gap == null
        ? '<span class="badge">—</span>'
        : sc.gap >= 0
          ? `<span class="badge pos">+${fmt(sc.gap, 2)}</span>`
          : `<span class="badge neg">${fmt(sc.gap, 2)}</span>`;
      return `<tr>
        <td>${esc(sc.label)}</td>
        <td class="num">${fmt(sc.gpa, 2)}</td>
        <td class="num">${fmt(sc.composite, 2)}</td>
        <td class="num">${sc.rank} / ${sc.total || '—'}</td>
        <td class="num">${gap} <button class="icon-btn" type="button" data-del="scenario" data-id="${sc.id}" aria-label="删除情景 ${esc(sc.label)}">×</button></td>
      </tr>`;
    }).join('')}</tbody>`;
}

function syncCourseFoot() {
  const s = computeStats(state);
  const el = $('#pane-course .table-foot');
  if (!el) return;
  el.innerHTML = `<span>计入学分 <b>${fmt(s.credits, s.credits % 1 ? 1 : 0)}</b> · 计分课程 <b>${s.courseCount}</b></span><span>${state.settings.onlyRequired ? '只计必修' : '含选修'}</span>`;
}

function syncBonusFoot() {
  const s = computeStats(state);
  const el = $('#pane-bonus .table-foot');
  if (!el) return;
  el.innerHTML = `<span>加分合计 <b>${fmt(s.bonusTotal, 1)}</b>${s.bonusCap != null ? ` · 上限 ${fmt(s.bonusCap, 1)}` : ''}</span>${s.bonusCapApplied ? '<span class="badge gold">已触顶</span>' : ''}`;
}

function syncCohortCells() {
  const s = computeStats(state);
  $$('#pane-cohort tbody tr[data-id]').forEach((tr) => {
    const p = s.cohort.find((x) => x.id === tr.dataset.id);
    const cell = tr.querySelector('.composite-cell');
    if (p && cell) cell.textContent = fmt(p.composite, 2);
  });
  const me = $('#pane-cohort tr.row-me');
  if (me) {
    const cells = me.querySelectorAll('td');
    if (cells[1]) cells[1].textContent = fmt(s.weightedAverage, 2);
    if (cells[2]) cells[2].textContent = fmt(s.bonusTotal, 1);
    if (cells[3]) cells[3].textContent = fmt(s.composite, 2);
  }
  const foot = $('#pane-cohort .table-foot');
  if (foot) foot.innerHTML = `<span>我的名次 <b>第 ${s.rank}</b> / ${s.cohortSize + 1}</span><span>名额 <b>${s.quota}</b></span>`;
}

function syncWeightEq() {
  const s = computeStats(state);
  const el = $('#pane-rules .weight-eq');
  if (!el) return;
  el.innerHTML = weightEquation(s);
}

function afterDataChange() {
  renderMetrics();
  renderVerdict();
  renderSens();
  renderScoreDeltas();
  renderAllDeltas();
  renderSolveHints();
  syncCourseFoot();
  syncBonusFoot();
  syncCohortCells();
  syncWeightEq();
  scheduleSave();
}

function renderAll({ keepSim = false } = {}) {
  if (!state.courses.some((c) => c.id === selectedCourseId)) {
    selectedCourseId = state.courses[0] ? state.courses[0].id : null;
  }
  if (!keepSim) simScore = null;
  setTab(activeTab);
  renderCoursePane();
  renderBonusPane();
  renderCohortPane();
  renderRulesPane();
  renderMetrics();
  renderVerdict();
  renderChips();
  renderSandbox();
  renderSens();
  renderScenarios();
}

// ---------- 交互 ----------

function updateStateFromInput(el) {
  const scope = el.dataset.scope;
  const field = el.dataset.field;
  if (!scope || el.tagName === 'SELECT') return false;

  if (scope === 'course') {
    const tr = el.closest('tr');
    const c = tr && state.courses.find((x) => x.id === tr.dataset.id);
    if (!c) return false;
    if (field === 'name') {
      c.name = el.value;
      const chip = document.querySelector(`.chip[data-chip="${c.id}"] b`);
      if (chip) chip.textContent = c.name || '未命名';
    } else if (field === 'credits') {
      if (el.value === '') return false;
      c.credits = Math.max(0, num(el.value));
    } else if (field === 'score') {
      if (el.value === '') return false;
      c.score = clamp(num(el.value), 0, 100);
    } else if (field === 'retake') {
      c.retake = el.value === '' ? null : clamp(num(el.value), 0, 100);
    } else {
      return false;
    }
    return true;
  }

  if (scope === 'bonus') {
    const tr = el.closest('tr');
    const b = tr && state.bonuses.find((x) => x.id === tr.dataset.id);
    if (!b) return false;
    if (field === 'name') b.name = el.value;
    else if (field === 'points') { if (el.value === '') return false; b.points = Math.max(0, num(el.value)); }
    else return false;
    return true;
  }

  if (scope === 'cohort') {
    const tr = el.closest('tr');
    const p = tr && state.cohort.find((x) => x.id === tr.dataset.id);
    if (!p) return false;
    if (field === 'name') p.name = el.value;
    else if (field === 'academic') { if (el.value === '') return false; p.academic = clamp(num(el.value), 0, 100); }
    else if (field === 'bonus') { if (el.value === '') return false; p.bonus = Math.max(0, num(el.value)); }
    else return false;
    return true;
  }

  if (scope === 'settings') {
    if (field === 'academicWeight' || field === 'bonusWeight') {
      if (el.value === '') return false;
      state.settings[field] = clamp(num(el.value), 0, 100);
    } else if (field === 'gpaTarget') {
      if (el.value === '') return false;
      state.settings.gpaTarget = Math.max(0, num(el.value));
    } else if (field === 'quota') {
      if (el.value === '') return false;
      state.settings.quota = Math.max(1, Math.round(num(el.value)));
    } else if (field === 'bonusCap') {
      state.settings.bonusCap = el.value === '' ? null : Math.max(0, num(el.value));
    } else {
      return false;
    }
    return true;
  }

  return false;
}

function onInput(e) {
  const el = e.target;
  if (el.dataset.scope === 'band') return;
  if (updateStateFromInput(el)) afterDataChange();
}

function onChange(e) {
  const el = e.target;

  if (el.name === 'gpaScheme') {
    state.settings.schemeId = el.value;
    simScore = null;
    renderRulesPane();
    renderSandbox();
    afterDataChange();
    return;
  }

  const scope = el.dataset.scope;
  const field = el.dataset.field;
  if (!scope) return;

  if (scope === 'course' && field === 'kind') {
    const tr = el.closest('tr');
    const c = tr && state.courses.find((x) => x.id === tr.dataset.id);
    if (c) c.kind = el.value === 'elective' ? 'elective' : 'required';
    afterDataChange();
    return;
  }

  if (scope === 'settings') {
    if (field === 'retakeMode') {
      state.settings.retakeMode = el.value;
      simScore = null;
      renderCoursePane();
      renderChips();
      renderSandbox();
      afterDataChange();
      return;
    }
    if (field === 'onlyRequired') {
      state.settings.onlyRequired = el.checked;
      renderCoursePane();
      renderSandbox();
      afterDataChange();
      return;
    }
  }

  if (scope === 'band') {
    const i = Number(el.dataset.index);
    const b = state.settings.customBands[i];
    if (!b) return;
    const v = num(el.value);
    if (field === 'min') b.min = clamp(v, 0, 100);
    else if (field === 'gp') b.gp = clamp(v, 0, 10);
    else return;
    renderRulesPane();
    afterDataChange();
  }
}

function onClick(e) {
  const chip = e.target.closest('[data-chip]');
  if (chip) {
    selectedCourseId = chip.dataset.chip;
    simScore = null;
    renderChips();
    renderSandbox();
    return;
  }

  const del = e.target.closest('[data-del]');
  if (del) {
    const kind = del.dataset.del;
    const id = del.dataset.id;
    if (kind === 'course') {
      state.courses = state.courses.filter((c) => c.id !== id);
      if (selectedCourseId === id) selectedCourseId = state.courses[0] ? state.courses[0].id : null;
      renderAll();
    } else if (kind === 'bonus') {
      state.bonuses = state.bonuses.filter((b) => b.id !== id);
      renderAll();
    } else if (kind === 'cohort') {
      state.cohort = state.cohort.filter((p) => p.id !== id);
      renderAll();
    } else if (kind === 'scenario') {
      scenarios = scenarios.filter((s) => s.id !== id);
      renderScenarios();
      scheduleSave();
    } else if (kind === 'band') {
      const i = Number(del.dataset.index);
      state.settings.customBands.splice(i, 1);
      renderRulesPane();
      afterDataChange();
    }
    scheduleSave();
    return;
  }

  const add = e.target.closest('[data-add]');
  if (add) {
    const kind = add.dataset.add;
    if (kind === 'course') {
      state.courses.push({ id: uid('c'), name: `新课程 ${state.courses.length + 1}`, credits: 3, score: 85, kind: 'required', retake: null });
      renderAll();
      scheduleSave();
      requestAnimationFrame(() => {
        const rows = $$('#pane-course tbody tr');
        const last = rows[rows.length - 1];
        const input = last && last.querySelector('input');
        if (input) { input.focus(); input.select(); }
      });
    } else if (kind === 'bonus') {
      state.bonuses.push({ id: uid('b'), name: `加分项 ${state.bonuses.length + 1}`, points: 0.5 });
      renderAll();
      scheduleSave();
    } else if (kind === 'cohort') {
      state.cohort.push({ id: uid('p'), name: `竞争者 ${state.cohort.length + 1}`, academic: 85, bonus: 0 });
      renderAll();
      scheduleSave();
    } else if (kind === 'band') {
      state.settings.customBands.push({ min: 0, gp: 0 });
      renderRulesPane();
      afterDataChange();
      scheduleSave();
    }
    return;
  }

  const preset = e.target.closest('[data-preset]');
  if (preset) {
    const p = BONUS_PRESETS.find((x) => x.id === preset.dataset.preset);
    if (p) {
      state.bonuses.push({ id: uid('b'), name: p.label, points: p.points });
      renderAll();
      scheduleSave();
      toast(`已加入「${p.label} +${p.points}」`);
    }
    return;
  }

  const fill = e.target.closest('[data-fill]');
  if (fill && fill.dataset.fill === 'cohort') {
    if (state.cohort.length && !confirm('用 6 位合成竞争者替换当前名单？')) return;
    state.cohort = [
      { id: uid('p'), name: '同学 A', academic: 92.0, bonus: 3.0 },
      { id: uid('p'), name: '同学 B', academic: 90.5, bonus: 1.5 },
      { id: uid('p'), name: '同学 C', academic: 89.2, bonus: 2.0 },
      { id: uid('p'), name: '同学 D', academic: 88.8, bonus: 0.5 },
      { id: uid('p'), name: '同学 E', academic: 87.4, bonus: 1.0 },
      { id: uid('p'), name: '同学 F', academic: 86.0, bonus: 2.5 },
    ];
    renderAll();
    scheduleSave();
    toast('已填入 6 位合成竞争者');
    return;
  }

  const weights = e.target.closest('[data-weights]');
  if (weights) {
    const [aw, bw] = weights.dataset.weights.split(',').map(Number);
    state.settings.academicWeight = aw;
    state.settings.bonusWeight = bw;
    const awInput = $('#pane-rules input[data-field="academicWeight"]');
    const bwInput = $('#pane-rules input[data-field="bonusWeight"]');
    if (awInput) awInput.value = String(aw);
    if (bwInput) bwInput.value = String(bw);
    syncWeightEq();
    afterDataChange();
    return;
  }
}

function saveScenario() {
  const s = computeStats(state);
  scenarios.push(makeScenario(`情景 ${scenarios.length + 1}`, s));
  renderScenarios();
  scheduleSave();
  toast('已保存当前情景');
}

function exportJSON() {
  const payload = {
    app: 'critical-point',
    v: 1,
    exportedAt: new Date().toISOString(),
    state,
    scenarios,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `临界点-备份-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1200);
  toast('已导出 JSON 备份');
}

async function importFile(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const raw = data.state || data;
    if (!raw || !Array.isArray(raw.courses)) throw new Error('bad shape');
    state = normalizeState(raw);
    scenarios = Array.isArray(data.scenarios) ? data.scenarios : [];
    selectedCourseId = state.courses[0] ? state.courses[0].id : null;
    simScore = null;
    allDelta = 0;
    $('#allSlider').value = '0';
    $('#allOut').textContent = '+0';
    renderAll();
    scheduleSave();
    toast('已导入，数据只保存在本机');
  } catch {
    toast('导入失败：不是临界点导出的 JSON', true);
  } finally {
    e.target.value = '';
  }
}

function resetAll() {
  if (!confirm('用合成示例覆盖当前数据？这会清空你录入的成绩、加分和竞争者。')) return;
  state = sampleState();
  scenarios = seedScenarios(deep(state));
  selectedCourseId = state.courses[0].id;
  simScore = null;
  allDelta = 0;
  $('#allSlider').value = '0';
  $('#allOut').textContent = '+0';
  renderAll();
  scheduleSave();
  toast('已重置为合成示例');
}

function initTabs() {
  const tabs = $$('.tab');
  tabs.forEach((t) => {
    t.addEventListener('click', () => setTab(t.dataset.tab));
    t.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const i = tabs.indexOf(t);
      const n = e.key === 'ArrowRight' ? (i + 1) % tabs.length : (i - 1 + tabs.length) % tabs.length;
      tabs[n].focus();
      setTab(tabs[n].dataset.tab);
    });
  });
}

function init() {
  initTabs();
  setTab('course');

  $('#btnExport').addEventListener('click', exportJSON);
  $('#btnReset').addEventListener('click', resetAll);
  $('#importFile').addEventListener('change', importFile);
  $('#btnSaveScenario').addEventListener('click', saveScenario);

  $('#scoreSlider').addEventListener('input', (e) => {
    simScore = Number(e.target.value);
    $('#scoreOut').textContent = e.target.value;
    renderScoreDeltas();
  });

  $('#allSlider').addEventListener('input', (e) => {
    allDelta = Number(e.target.value);
    renderAllDeltas();
  });

  $('#applyScore').addEventListener('click', () => {
    const c = selectedCourse();
    if (!c) return;
    const v = clamp(Number($('#scoreSlider').value), 0, 100);
    if (state.settings.retakeMode === 'none') c.score = v;
    else c.retake = v;
    simScore = null;
    renderAll();
    scheduleSave();
    toast(state.settings.retakeMode === 'none' ? `已写入「${c.name}」成绩 ${v}` : `已写入「${c.name}」重修成绩 ${v}`);
  });

  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  document.addEventListener('click', onClick);

  renderAll();
  setSaveState(stored ? '已读取本机数据' : '示例数据 · 合成');
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
