/* eslint-env browser */
/**
 * The cue review page (docs/ADMIN.md). Plain JS so the server needs no build
 * step; the filtering and trust logic come from review.ts, served stripped of
 * types at /review.js.
 *
 * Every string from the database is athlete- or model-authored, so nothing is
 * ever assigned as HTML — `h()` builds text nodes only.
 */
import {
  CUE_VERDICTS,
  DEFAULT_FILTERS,
  GROUNDING_OUTCOMES,
  WRONG_REASONS,
  filterSessions,
  isTrustworthy,
  reviewCoverage,
  withVerdicts,
} from './review.js';

// ── DOM helper ──────────────────────────────────────────────────────────────

function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') el.className = value;
    else if (key.startsWith('on')) el.addEventListener(key.slice(2), value);
    else if (key in el && typeof value !== 'string') el[key] = value;
    else el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : document.createTextNode(child));
  }
  return el;
}

// ── Copy ────────────────────────────────────────────────────────────────────

const GROUNDING = {
  grounded: ['Grounded', 'Records were selected for the coaching prompt.'],
  withheld: [
    'Withheld',
    'Records were available, but the experiment held them back (control arm).',
  ],
  no_position: [
    'No position',
    'The position never resolved to a canonical id, so no records were looked up.',
  ],
  no_records: [
    'No records',
    'The position resolved, but no records survived for it.',
  ],
  declined: [
    'Declined',
    'The take had nothing coachable in it, so no Cue was written.',
  ],
};

const TRAIL = {
  trusted: ['ok', 'These records went into the prompt that produced this Cue.'],
  none_selected: ['ok', 'No coaching records went into this Cue.'],
  not_recorded: [
    'warn',
    'Not recorded. This session predates record-id logging (migration 018), so which records grounded it is unknown.',
  ],
  never_reached_model: [
    'bad',
    'Selected but never reached the model. Pipeline 1.0.0 prompts carried a literal {{GROUNDING}} placeholder instead of these records (migration 019).',
  ],
  unverified: [
    'warn',
    'Unverified. Before pipeline 1.3.0, re-analysis left no marker; if this session was re-analysed, these records belong to an earlier Cue (migration 021).',
  ],
};

const STATUS_LABEL = {
  certified: 'Certified',
  contested: 'Contested',
  rejected: 'Rejected',
  unsettled: 'Unsettled',
};

/** Operator verdicts (#132): [label, badge tone]. */
const VERDICT = {
  sound: ['Sound', 'ok'],
  shallow: ['Shallow', 'warn'],
  wrong: ['Wrong', 'bad'],
};

/** Why a Cue is wrong: [short label, what it means]. Upstream first. */
const REASON = {
  transcript_misheard: [
    'Transcript misheard',
    'a vocabulary-priming problem upstream',
  ],
  extraction_wrong: ['Extraction wrong', 'the wrong mistake, position or side'],
  records_wrong: ['A record is wrong', 'an injected record is itself wrong'],
  records_misapplied: [
    'Records misapplied',
    'the records were right, the model misused them',
  ],
  off_target: ['Off target', 'sound jiu-jitsu aimed at the wrong problem'],
  model_wrong: [
    'Model wrong',
    'no relevant records, and the model’s own jiu-jitsu was wrong',
  ],
};

const verdictText = (v) =>
  `${VERDICT[v.verdict][0]}${v.reason ? `: ${REASON[v.reason][0].toLowerCase()}` : ''}`;

/** The hash that shows the records panel instead of a Session. */
const RECORDS_VIEW = 'records';

const NOT_RECORDED = [
  ['Skill level', 'only the profile’s current value exists'],
  ['Recent mistakes', 'built from earlier sessions at the time'],
  ['Dominant weakness', 'only the current trend exists'],
  ['Strict retry', 'whether the quality gate retried'],
  ['AI provider', 'Claude or Gemini'],
];

const dateTime = (iso) =>
  new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
const shortId = (id) => id.slice(0, 8);
const wordCount = (text) => text.trim().split(/\s+/).filter(Boolean).length;

// ── State ───────────────────────────────────────────────────────────────────

const state = {
  sessions: [],
  meta: {
    athletes: [],
    positions: [],
    positionLabels: {},
    reasons: [],
    verdictsAvailable: false,
  },
  filters: { ...DEFAULT_FILTERS },
  selected: decodeURIComponent(location.hash.slice(1)) || null,
};

async function readJson(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `${res.status} ${res.statusText}`);
  return body;
}

async function getJson(url) {
  // Resolved against the origin, which never carries credentials: opened as
  // http://user:pass@127.0.0.1, a relative fetch inherits them and Chromium
  // refuses to construct the request.
  return readJson(await fetch(new URL(url, location.origin)));
}

/**
 * The one write: `POST /api/verdict`, as JSON, which a cross-site form cannot
 * send. A same-origin fetch carries this page's own `Origin` and
 * `Sec-Fetch-Site: same-origin`, which is exactly what the server's write
 * guard admits (docs/ADMIN.md).
 */
async function postJson(url, body) {
  return readJson(
    await fetch(new URL(url, location.origin), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );
}

// ── Filters ─────────────────────────────────────────────────────────────────

function select(key, label, options) {
  return h(
    'label',
    { class: 'field' },
    h('span', {}, label),
    h(
      'select',
      {
        name: key,
        onchange: (e) => setFilter(key, e.target.value),
      },
      options.map(([value, text]) =>
        h('option', { value, selected: state.filters[key] === value }, text),
      ),
    ),
  );
}

function renderFilters() {
  const { athletes, positions, reasons } = state.meta;
  const form = document.getElementById('filters');
  form.replaceChildren(
    h('input', {
      type: 'search',
      name: 'query',
      class: 'search',
      placeholder: 'Search transcript, Cue, key mistake',
      'aria-label': 'Search',
      value: state.filters.query,
      oninput: (e) => setFilter('query', e.target.value),
    }),
    h(
      'div',
      { class: 'grid' },
      select('feedback', 'Athlete feedback', [
        ['any', 'Any'],
        ['down', '👎 Thumbs down'],
        ['up', '👍 Thumbs up'],
        ['none', 'Not rated'],
      ]),
      select('reason', '👎 reason', [
        ['', 'Any'],
        ...reasons.map((r) => [r, r]),
      ]),
      select('grounding', 'Grounding', [
        ['coachable', 'All but declined'],
        ['all', 'All, incl. declined'],
        ...GROUNDING_OUTCOMES.map((g) => [g, GROUNDING[g][0]]),
      ]),
      select('position', 'Target position', [
        ['', 'Any'],
        ...positions.map((p) => [p.id, p.label]),
      ]),
      select('gate', 'Quality gate', [
        ['any', 'Any'],
        ['passed', 'Passed'],
        ['fell_back', 'Fell back'],
      ]),
      select('trail', 'Record trail', [
        ['any', 'Any'],
        ['trustworthy', 'Trustworthy'],
        ['untrustworthy', 'Not trustworthy'],
      ]),
      select('athlete', 'Athlete', [
        ['', 'Any'],
        ...athletes.map((a) => [a.id, `${a.name} · ${shortId(a.id)}`]),
      ]),
      select('verdict', 'Operator verdict', [
        ['any', 'Any'],
        ['unjudged', 'Unjudged'],
        ['judged', 'Judged'],
        ...CUE_VERDICTS.map((v) => [v, VERDICT[v][0]]),
        ['earlier', 'About an earlier Cue'],
      ]),
      select('verdictReason', 'Wrong because', [
        ['', 'Any'],
        ...WRONG_REASONS.map((r) => [r, REASON[r][0]]),
      ]),
      h(
        'div',
        { class: 'field dates' },
        h('span', {}, 'Date (UTC)'),
        h(
          'div',
          { class: 'row' },
          h('input', {
            type: 'date',
            'aria-label': 'From date',
            value: state.filters.from,
            onchange: (e) => setFilter('from', e.target.value),
          }),
          h('input', {
            type: 'date',
            'aria-label': 'To date',
            value: state.filters.to,
            onchange: (e) => setFilter('to', e.target.value),
          }),
        ),
      ),
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'link',
        onclick: () => {
          state.filters = { ...DEFAULT_FILTERS };
          renderFilters();
          renderList();
        },
      },
      'Reset filters',
    ),
  );
}

function setFilter(key, value) {
  state.filters[key] = value;
  renderList();
}

// ── List ────────────────────────────────────────────────────────────────────

function badge(text, tone = '') {
  return h('span', { class: `badge ${tone}` }, text);
}

/** How much of the log is judged, so a pattern can be told from a thin sample. */
function renderCoverage(visible) {
  const line = document.getElementById('coverage');
  if (!state.meta.verdictsAvailable) {
    line.textContent =
      'Verdicts unavailable: migration 026 (cue_verdicts) is probably not applied.';
    return;
  }
  const all = reviewCoverage(state.sessions);
  const pct = all.cues === 0 ? 0 : Math.round((100 * all.judged) / all.cues);
  let text = `Judged ${all.judged} of ${all.cues} Cues (${pct}%): ${all.sound} sound, ${all.shallow} shallow, ${all.wrong} wrong`;
  if (all.earlier > 0) text += ` · ${all.earlier} about an earlier Cue`;
  if (visible.length !== state.sessions.length) {
    const here = reviewCoverage(visible);
    text += ` · ${here.judged} of ${here.cues} in this view`;
  }
  line.textContent = text;
}

function renderList() {
  const visible = filterSessions(state.sessions, state.filters);
  document.getElementById('count').textContent =
    `${visible.length} of ${state.sessions.length}`;
  renderCoverage(visible);

  const list = document.getElementById('list');
  if (visible.length === 0) {
    list.replaceChildren(
      h('li', { class: 'empty muted' }, 'No sessions match these filters.'),
    );
    return;
  }
  list.replaceChildren(
    ...visible.map((s) =>
      h(
        'li',
        {},
        h(
          'button',
          {
            type: 'button',
            class: `item${s.id === state.selected ? ' active' : ''}`,
            'aria-current': s.id === state.selected ? 'true' : null,
            onclick: () => selectSession(s.id),
          },
          h(
            'span',
            { class: 'meta' },
            `${dateTime(s.sessionDate)} · ${s.athlete}`,
          ),
          s.cue
            ? h('span', { class: 'cue' }, s.cue)
            : h('span', { class: 'cue muted' }, 'No Cue'),
          h(
            'span',
            { class: 'badges' },
            s.targetPositionLabel && badge(s.targetPositionLabel),
            s.grounding && badge(GROUNDING[s.grounding][0], s.grounding),
            s.thumbsUp === true && badge('👍'),
            s.thumbsUp === false &&
              badge(
                `👎${s.feedbackReason ? ` ${s.feedbackReason}` : ''}`,
                'bad',
              ),
            s.gatePassed === false && badge('Fell back', 'warn'),
            !isTrustworthy(s.trail) && badge('⚠ Trail', 'warn'),
            s.reanalyzed && badge('Re-analysed'),
            s.verdict &&
              badge(
                `Judged ${verdictText({ verdict: s.verdict, reason: s.verdictReason }).toLowerCase()}`,
                VERDICT[s.verdict][1],
              ),
            s.earlierVerdicts > 0 && badge('Earlier Cue judged', 'warn'),
          ),
        ),
      ),
    ),
  );
}

// ── Detail ──────────────────────────────────────────────────────────────────

function section(title, ...children) {
  return h('section', { class: 'section' }, h('h2', {}, title), ...children);
}

function facts(pairs) {
  return h(
    'dl',
    { class: 'facts' },
    pairs.flatMap(([term, value]) => [
      h('dt', {}, term),
      h(
        'dd',
        {},
        value === null || value === undefined || value === ''
          ? h('span', { class: 'muted' }, 'none')
          : value,
      ),
    ]),
  );
}

const BUILD_PROMPT = 'Build today’s prompt';

function promptView(p) {
  const pre = h('pre', { class: 'prompt' }, p.prompt);
  const copy = h(
    'button',
    {
      type: 'button',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(p.prompt);
          copy.textContent = 'Copied';
        } catch {
          // Clipboard refused: select the text so ⌘C still works.
          const range = document.createRange();
          range.selectNodeContents(pre);
          getSelection().removeAllRanges();
          getSelection().addRange(range);
          copy.textContent = 'Selected, press ⌘C';
        }
        setTimeout(() => (copy.textContent = 'Copy prompt'), 2000);
      },
    },
    'Copy prompt',
  );
  const s = p.selection;
  const [headline, ...rest] = p.caveats;
  return h(
    'div',
    { class: 'prompt-view' },
    h('p', { class: 'callout warn' }, headline),
    h(
      'ul',
      { class: 'caveats small' },
      rest.map((c) => h('li', {}, c)),
    ),
    h(
      'p',
      { class: 'funnel small' },
      `Positions: ${p.positions.join(', ') || 'none resolved'} · records ${s.pool} → gi filter ${s.afterGi} → cleared relevance gate ${s.gatePassed} → injected ${s.injected}`,
    ),
    p.stored &&
      h(
        'p',
        { class: `callout small ${p.stored.sameOrder ? 'ok' : 'warn'}` },
        p.stored.sameOrder
          ? `Same ${p.stored.today} records, in the same order, as this session’s stored prompt.`
          : `Records differ from this session’s stored prompt: today picks ${p.stored.shared} of its ${p.stored.stored} stored records, ${p.stored.today} in total.`,
        ' The stored list is only as reliable as the record trail under Grounding.',
      ),
    h(
      'div',
      { class: 'actions' },
      copy,
      h(
        'span',
        { class: 'muted small' },
        `${p.prompt.length.toLocaleString()} characters`,
      ),
    ),
    pre,
  );
}

/** The recording, plus a prompt rebuilt from today's inputs to copy elsewhere. */
function audioSection(id, hasAudio) {
  const actions = h('div', { class: 'actions' });
  const audioSlot = h('div', {});
  const promptSlot = h('div', {});

  if (hasAudio) {
    const play = h(
      'button',
      {
        type: 'button',
        onclick: async () => {
          play.disabled = true;
          play.textContent = 'Loading…';
          try {
            const { url } = await getJson(`/api/sessions/${id}/audio`);
            audioSlot.replaceChildren(
              h('audio', { controls: true, autoplay: true, src: url }),
            );
            play.remove();
          } catch (err) {
            play.disabled = false;
            play.textContent = 'Play recording';
            audioSlot.replaceChildren(h('p', { class: 'error' }, err.message));
          }
        },
      },
      'Play recording',
    );
    actions.append(play);
  } else {
    actions.append(h('span', { class: 'muted' }, 'No audio stored.'));
  }

  const build = h(
    'button',
    {
      type: 'button',
      onclick: async () => {
        build.disabled = true;
        build.textContent = 'Building…';
        try {
          const p = await getJson(`/api/sessions/${id}/prompt`);
          promptSlot.replaceChildren(promptView(p));
          build.textContent = 'Rebuild prompt';
        } catch (err) {
          promptSlot.replaceChildren(h('p', { class: 'error' }, err.message));
          build.textContent = BUILD_PROMPT;
        } finally {
          build.disabled = false;
        }
      },
    },
    BUILD_PROMPT,
  );
  actions.append(build);

  return section('Recording & prompt', actions, audioSlot, promptSlot);
}

function recordCard(entry, labels) {
  if (!entry.record) {
    return h(
      'li',
      { class: 'record missing' },
      h('span', { class: 'rank' }, `#${entry.rank}`),
      h(
        'p',
        { class: 'muted' },
        `Record ${entry.id} no longer exists in coaching_records.`,
      ),
    );
  }
  const r = entry.record;
  return h(
    'li',
    { class: 'record' },
    h(
      'div',
      { class: 'record-head' },
      h('span', { class: 'rank' }, `#${entry.rank}`),
      h('span', {}, labels[r.position] ?? r.position),
      badge(STATUS_LABEL[entry.status], entry.status),
      h(
        'span',
        { class: 'muted' },
        `${entry.certifyVotes} sound · ${entry.rejectVotes} wrong`,
      ),
    ),
    h('p', { class: 'prescription' }, r.prescription),
    facts([
      ['Why', r.why],
      ['Detail', r.detail],
      ['Counter', r.counter],
      [
        'Applies',
        [
          r.gi === 'either' ? 'Gi and no-gi' : r.gi,
          r.level === 'any' ? 'any level' : r.level,
          r.opponent ? `opponent: ${r.opponent}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
      ],
      ['Id', h('code', {}, r.id)],
    ]),
  );
}

function groundingSection(d, labels) {
  const s = d.session;
  const [trailTone, trailText] = TRAIL[d.trail];
  const outcome = s.grounding ? GROUNDING[s.grounding] : null;
  const f = d.funnel;
  const count = (value) => (value === null ? 'not recorded' : String(value));

  return section(
    'Grounding',
    h(
      'p',
      {},
      outcome
        ? [badge(outcome[0], s.grounding), ' ', outcome[1]]
        : h('span', { class: 'muted' }, 'No grounding outcome recorded.'),
    ),
    h(
      'p',
      { class: 'funnel' },
      `Candidates ${f.candidates.atLeast ? '≥ ' : ''}${count(f.candidates.value)}`,
      ' → ',
      `cleared relevance gate ${count(f.gatePassed)}`,
      ' → ',
      `injected ${count(f.injected)}`,
    ),
    h('p', { class: `callout ${trailTone}` }, trailText),
    d.records.length > 0 &&
      h(
        'p',
        { class: 'muted small' },
        'Record text is shown as it is today. Publishing updates records in place, so it may differ from what the model saw (#121).',
      ),
    d.records.length > 0 &&
      h(
        'ol',
        { class: 'records' },
        d.records.map((e) => recordCard(e, labels)),
      ),
  );
}

function copyButton(text, pre) {
  const copy = h(
    'button',
    {
      type: 'button',
      onclick: async () => {
        try {
          await navigator.clipboard.writeText(text);
          copy.textContent = 'Copied';
        } catch {
          // Clipboard refused: select the text so ⌘C still works.
          const range = document.createRange();
          range.selectNodeContents(pre);
          getSelection().removeAllRanges();
          getSelection().addRange(range);
          copy.textContent = 'Selected, press ⌘C';
        }
        setTimeout(() => (copy.textContent = 'Copy prompt'), 2000);
      },
    },
    'Copy prompt',
  );
  return copy;
}

const RECORDED_PROMPT = 'Prompt the model received';

/** The logged prompt behind this Cue (#121), or why there is none to show. */
function recordedPromptSection(p) {
  if (!p.available) {
    return section(
      RECORDED_PROMPT,
      h(
        'p',
        { class: 'callout warn' },
        'The prompt log could not be read. Migration 023 (session_prompts) is probably not applied to this database yet.',
      ),
    );
  }
  if (!p.latest) {
    return section(
      RECORDED_PROMPT,
      h(
        'p',
        { class: 'muted small' },
        'Not recorded: this Cue was generated before prompt logging (#121). These inputs went into its prompt but were never saved:',
      ),
      h(
        'ul',
        { class: 'unknowns' },
        NOT_RECORDED.map(([name, why]) =>
          h('li', {}, h('strong', {}, name), ` (${why})`),
        ),
      ),
    );
  }

  const { attempts, produced, run, runs } = p.latest;
  const shown = produced ?? attempts[attempts.length - 1];
  const pre = h('pre', { class: 'prompt' }, shown.prompt);
  const label = (a) =>
    `Attempt ${a.attempt}${a.strict ? ' (strict retry)' : ''}`;

  return section(
    RECORDED_PROMPT,
    h(
      'p',
      { class: `callout ${produced ? 'ok' : 'warn'}` },
      produced
        ? `Exactly what the model received for the Cue below: ${label(shown).toLowerCase()} of ${attempts.length}.`
        : `No attempt produced the Cue below: all ${attempts.length} failed the quality gate, which fell back to its safe Cue. Showing the last attempt.`,
    ),
    facts([
      ['Model', `${shown.provider} · ${shown.model}`],
      [
        'Run',
        run === 'reanalysis'
          ? `Re-analysis${runs > 1 ? `, latest of ${runs} runs` : ''}`
          : 'Original recording',
      ],
      ['Sent', dateTime(shown.created_at)],
    ]),
    h(
      'div',
      { class: 'actions' },
      copyButton(shown.prompt, pre),
      h(
        'span',
        { class: 'muted small' },
        `${shown.prompt.length.toLocaleString()} characters`,
      ),
    ),
    pre,
    attempts
      .filter((a) => a !== shown)
      .map((a) =>
        h(
          'details',
          { class: 'attempt' },
          h('summary', {}, `${label(a)}, rejected by the quality gate`),
          h('pre', { class: 'prompt' }, a.prompt),
        ),
      ),
  );
}

// ── Operator verdict (#132) ─────────────────────────────────────────────────

const VERDICT_TITLE = 'Operator verdict';

/** After a write: the Session's verdicts as the server now holds them. */
function applyVerdicts(d, result) {
  d.verdicts = {
    available: true,
    current: result.current,
    earlier: result.earlier,
  };
  state.sessions = state.sessions.map((s) =>
    s.id === d.session.id ? withVerdicts(s, result.verdicts) : s,
  );
  renderList();
}

function verdictForm(d, onSaved, notice) {
  const s = d.session;
  const current = d.verdicts.current;
  const status = h('p', { class: 'small', role: 'status' }, notice);
  const name = `verdict-${s.id}`;

  const reason = h(
    'select',
    { name: 'reason', 'aria-label': 'Why the Cue is wrong' },
    h('option', { value: '' }, 'Choose a reason…'),
    WRONG_REASONS.map((r) =>
      h(
        'option',
        { value: r, selected: current?.reason === r },
        `${REASON[r][0]}: ${REASON[r][1]}`,
      ),
    ),
  );
  const reasonField = h(
    'label',
    { class: 'field', hidden: current?.verdict !== 'wrong' },
    h('span', {}, 'Wrong because (required)'),
    reason,
  );
  const note = h(
    'textarea',
    { name: 'note', rows: 2, 'aria-label': 'Note', placeholder: 'Optional' },
    current?.note ?? '',
  );
  const chosen = () =>
    form.querySelector(`input[name="${name}"]:checked`)?.value ?? null;

  const send = async (body, button) => {
    button.disabled = true;
    status.className = 'small';
    status.textContent = 'Saving…';
    try {
      applyVerdicts(d, await postJson('/api/verdict', body));
      onSaved(body.verdict === null ? 'Cleared.' : 'Saved.');
    } catch (err) {
      status.className = 'small error';
      status.textContent = err.message;
      button.disabled = false;
    }
  };

  const save = h('button', { type: 'submit' }, 'Save verdict');
  const form = h(
    'form',
    {
      class: 'verdict-form',
      onsubmit: (e) => {
        e.preventDefault();
        const verdict = chosen();
        if (!verdict) {
          status.className = 'small error';
          status.textContent = 'Pick sound, shallow or wrong.';
          return;
        }
        if (verdict === 'wrong' && !reason.value) {
          status.className = 'small error';
          status.textContent = 'A wrong Cue needs a reason.';
          return;
        }
        void send(
          {
            sessionId: s.id,
            cue: s.coaching_cue,
            verdict,
            reason: verdict === 'wrong' ? reason.value : null,
            note: note.value,
          },
          save,
        );
      },
    },
    h(
      'fieldset',
      { class: 'choices' },
      h('legend', {}, 'This Cue is'),
      CUE_VERDICTS.map((v) =>
        h(
          'label',
          { class: 'choice' },
          h('input', {
            type: 'radio',
            name,
            value: v,
            checked: current?.verdict === v,
            onchange: () => (reasonField.hidden = v !== 'wrong'),
          }),
          VERDICT[v][0],
        ),
      ),
    ),
    reasonField,
    h('label', { class: 'field' }, h('span', {}, 'Note'), note),
    h(
      'div',
      { class: 'actions' },
      save,
      current &&
        h(
          'button',
          {
            type: 'button',
            onclick: (e) =>
              void send(
                { sessionId: s.id, cue: current.cue, verdict: null },
                e.currentTarget,
              ),
          },
          'Clear verdict',
        ),
    ),
    status,
  );
  return form;
}

/** A verdict whose Cue was since replaced: shown, never as judging this one. */
function earlierVerdict(d, v, onSaved) {
  const status = h('p', { class: 'small error', role: 'status' });
  const clear = h(
    'button',
    {
      type: 'button',
      onclick: async () => {
        clear.disabled = true;
        try {
          applyVerdicts(
            d,
            await postJson('/api/verdict', {
              sessionId: d.session.id,
              cue: v.cue,
              verdict: null,
            }),
          );
          onSaved('Cleared.');
        } catch (err) {
          status.textContent = err.message;
          clear.disabled = false;
        }
      },
    },
    'Clear this verdict',
  );
  return h(
    'div',
    { class: 'callout warn earlier' },
    h(
      'p',
      {},
      h('strong', {}, 'About an earlier Cue. '),
      `You judged it ${verdictText(v).toLowerCase()} on ${dateTime(v.updated_at)}. The Session’s Cue has been replaced since, so this verdict does not judge the Cue above. The Cue it judged:`,
    ),
    h('blockquote', {}, v.cue),
    v.note && h('p', { class: 'small' }, `Note: ${v.note}`),
    h('div', { class: 'actions' }, clear),
    status,
  );
}

function verdictSection(d, notice = null) {
  const s = d.session;
  const v = d.verdicts;
  let el;
  const rerender = (message) => {
    const next = verdictSection(d, message);
    el.replaceWith(next);
  };
  if (!v.available) {
    el = section(
      VERDICT_TITLE,
      h(
        'p',
        { class: 'callout warn' },
        'Verdicts could not be read. Migration 026 (cue_verdicts) is probably not applied to this database yet.',
      ),
    );
    return el;
  }
  el = section(
    VERDICT_TITLE,
    h(
      'p',
      { class: 'muted small' },
      'Your judgement of the Cue above, kept apart from the athlete’s. An observation only: nothing in the app, Grounding or the certification queue reads it.',
    ),
    facts(
      [
        [
          'Athlete said',
          s.thumbs_up === null
            ? 'Not rated'
            : `${s.thumbs_up ? '👍' : '👎'}${s.feedback_reason ? ` ${s.feedback_reason}` : ''}`,
        ],
        ['You said', v.current ? verdictText(v.current) : 'Unjudged'],
        v.current && ['Judged', dateTime(v.current.updated_at)],
      ].filter(Boolean),
    ),
    s.coaching_cue
      ? verdictForm(d, rerender, notice)
      : h('p', { class: 'muted' }, 'No Cue to judge.', notice && ` ${notice}`),
    v.earlier.map((e) => earlierVerdict(d, e, rerender)),
  );
  return el;
}

// ── Records behind wrong Cues (#132 story 6) ────────────────────────────────

function sessionLink(id) {
  const s = state.sessions.find((x) => x.id === id);
  return h(
    'button',
    { type: 'button', class: 'link', onclick: () => selectSession(id) },
    s ? `${dateTime(s.sessionDate)} · ${s.athlete}` : shortId(id),
  );
}

function signalCard(entry, rank, labels) {
  const reasons = WRONG_REASONS.filter((r) => entry.byReason[r] > 0)
    .map((r) => `${REASON[r][0]} ${entry.byReason[r]}`)
    .join(' · ');
  const r = entry.record;
  return h(
    'li',
    { class: 'record' },
    h(
      'div',
      { class: 'record-head' },
      h('span', { class: 'rank' }, `#${rank}`),
      r
        ? h('span', {}, labels[r.position] ?? r.position)
        : h('span', { class: 'muted' }, 'No longer in coaching_records'),
      entry.status && badge(STATUS_LABEL[entry.status], entry.status),
      h(
        'span',
        { class: 'muted' },
        `behind ${entry.wrong} wrong of ${entry.judged} judged`,
      ),
    ),
    r && h('p', { class: 'prescription' }, r.prescription),
    facts([
      ['Wrong because', reasons],
      [
        'Sessions',
        h(
          'span',
          { class: 'links' },
          entry.sessionIds.map((id) => sessionLink(id)),
        ),
      ],
      ['Id', h('code', {}, entry.recordId)],
    ]),
  );
}

function renderRecords(p) {
  const main = document.getElementById('detail');
  const head = h(
    'header',
    { class: 'detail-head' },
    h('h1', {}, 'Records behind wrong Cues'),
    h(
      'p',
      { class: 'muted' },
      'Every Coaching record that sat behind a Cue you judged wrong. Most “a record is wrong” verdicts first, then most wrong verdicts, then fewest appearances. Counted from the records kept with each verdict, so a Re-analyze never moves them. An observation for choosing what to review: the certification queue does not read it yet.',
    ),
  );
  if (!p.available) {
    main.replaceChildren(
      head,
      h(
        'p',
        { class: 'callout warn' },
        'Verdicts could not be read. Migration 026 (cue_verdicts) is probably not applied to this database yet.',
      ),
    );
    return;
  }
  const w = p.wrong;
  main.replaceChildren(
    head,
    section(
      'Wrong verdicts',
      h(
        'p',
        { class: 'funnel' },
        `${w.total} wrong: ${w.traced} with a trusted record trail, counted below · ${w.noRecords} with no records behind them · ${w.untraced} whose trail could not say which records were behind them`,
      ),
      p.records.length === 0
        ? h(
            'p',
            { class: 'muted' },
            'No record has sat behind a Cue judged wrong yet.',
          )
        : h(
            'ol',
            { class: 'records' },
            p.records.map((e, i) =>
              signalCard(e, i + 1, state.meta.positionLabels),
            ),
          ),
    ),
  );
  main.scrollTop = 0;
}

async function showRecords() {
  state.selected = RECORDS_VIEW;
  history.replaceState(null, '', `#${RECORDS_VIEW}`);
  renderList();
  const main = document.getElementById('detail');
  main.replaceChildren(h('p', { class: 'empty muted' }, 'Loading…'));
  try {
    const p = await getJson('/api/verdicts/records');
    if (state.selected === RECORDS_VIEW) renderRecords(p);
  } catch (err) {
    main.replaceChildren(h('p', { class: 'empty error' }, err.message));
  }
}

function renderDetail(d) {
  const s = d.session;
  const labels = state.meta.positionLabels;
  const main = document.getElementById('detail');
  main.replaceChildren(
    h(
      'header',
      { class: 'detail-head' },
      h('h1', {}, `${d.athlete} · ${dateTime(s.session_date)}`),
      h(
        'p',
        { class: 'muted' },
        `user ${shortId(s.user_id)} · session `,
        h('code', {}, s.id),
        ` · pipeline ${s.pipeline_version ?? 'unknown'}`,
      ),
    ),
    audioSection(s.id, d.hasAudio),
    section(
      'Transcript',
      s.reanalyzed_at &&
        h(
          'p',
          { class: 'callout warn' },
          `Re-analysed ${dateTime(s.reanalyzed_at)}. The original transcript and Cue were overwritten.`,
        ),
      s.raw_transcript
        ? h('p', { class: 'transcript' }, s.raw_transcript)
        : h('p', { class: 'muted' }, 'No transcript.'),
    ),
    section(
      'Extraction',
      facts([
        ['Positions visited', (s.positions_visited ?? []).join(', ')],
        ['Key mistake', s.key_mistake],
        ['Opponent action', s.opponent_action],
        ['Sentiment', s.sentiment],
        ['Gi', s.gi],
      ]),
    ),
    groundingSection(d, labels),
    recordedPromptSection(d.prompts),
    section(
      'Cue',
      s.coaching_cue
        ? [
            h('p', { class: 'cue-out' }, s.coaching_cue),
            h(
              'p',
              { class: 'muted small' },
              `${wordCount(s.coaching_cue)} words`,
            ),
          ]
        : h('p', { class: 'muted' }, 'No Cue was written.'),
      facts([
        ['Target position', d.positionLabel ?? s.target_position],
        [
          'Quality gate',
          s.quality_gate_passed === null
            ? null
            : s.quality_gate_passed
              ? 'Passed'
              : 'Fell back to the safe Cue',
        ],
        [
          'Athlete feedback',
          s.thumbs_up === null ? 'Not rated' : s.thumbs_up ? '👍' : '👎',
        ],
        ['Reason', s.feedback_reason],
        ['Note', s.feedback_note],
      ]),
    ),
    verdictSection(d),
  );
  main.scrollTop = 0;
}

async function selectSession(id) {
  state.selected = id;
  history.replaceState(null, '', `#${encodeURIComponent(id)}`);
  renderList();
  const main = document.getElementById('detail');
  main.replaceChildren(h('p', { class: 'empty muted' }, 'Loading…'));
  try {
    const d = await getJson(`/api/sessions/${id}`);
    if (state.selected === id) renderDetail(d);
  } catch (err) {
    main.replaceChildren(h('p', { class: 'empty error' }, err.message));
  }
}

// ── Boot ────────────────────────────────────────────────────────────────────

async function boot() {
  const main = document.getElementById('detail');
  try {
    const data = await getJson('/api/sessions');
    state.sessions = data.sessions;
    state.meta = data;
  } catch (err) {
    main.replaceChildren(
      h(
        'p',
        { class: 'empty error' },
        `Could not load sessions: ${err.message}`,
      ),
    );
    return;
  }
  document.getElementById('records-link').onclick = () => void showRecords();
  renderFilters();
  renderList();
  if (state.selected === RECORDS_VIEW) void showRecords();
  else if (state.selected) void selectSession(state.selected);
  else
    main.replaceChildren(h('p', { class: 'empty muted' }, 'Pick a session.'));
}

void boot();
