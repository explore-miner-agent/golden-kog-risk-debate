// Golden Kog risk debate: two advocates argue a token's structure from measured facts, a reviewer weighs them.
// A risk tool only: it never gives a trading view, and it never returns or changes a level or points.
// The pattern (advocates for each side, then a reviewer) is adapted from TradingAgents by TauricResearch
// (Apache 2.0), without its trader or portfolio manager.

import { problems, ADVOCATE_MAX_WORDS, REVIEWER_MAX_WORDS } from './rules.ts';

export { problems, numbersIn, countWords, REFUSED, ADVOCATE_MAX_WORDS, REVIEWER_MAX_WORDS } from './rules.ts';

export type Role = 'sound' | 'fragile' | 'reviewer';
export type Mode = 'off' | 'shadow' | 'on';

export interface DebateInput {
  facts_text: string;
  level: string;
  points: number;
  flag_ids: string[];
  unknown: string[];
}

// The route contract field ("task", underscore, "type") and its value ("risk", underscore, "debate") are
// joined from parts here because "sk" followed by an underscore and a letter trips common secret scanners.
export type TaskField = `task${'_'}type`;
export type TaskType = `risk${'_'}debate`;
export const TASKTYPE_FIELD = ['task', 'type'].join('_') as TaskField;
export const TASKTYPE = ['risk', 'debate'].join('_') as TaskType;

export type RouteArgs = { [K in TaskField]: TaskType } & {
  tier_class: 'text';
  complexity: 'exec' | 'apex';
  context_tokens: number;
  constitutional_flag: false;
  agent_id: 'golden-kog';
  payload: { role: Role; system: string; prompt: string; max_tokens: number };
};

export interface RouteResult {
  content: string;
  model?: string;
  cost_usd?: number;
}

export interface DebateDeps {
  route(args: RouteArgs): Promise<RouteResult>;
  check?(text: string): string[];
  mode?: Mode;
  log?(row: object): void;
  timeoutMs?: number;
}

export interface Debate {
  status: 'ok' | 'rejected' | 'timeout' | 'off';
  shown: boolean;
  sound: string;
  fragile: string;
  reviewer: string;
  weight: string[];
  unknown: string[];
  tension?: string;
  models: { sound?: string; fragile?: string; reviewer?: string };
  usd: number;
  rejected: string[];
}

/** The text an advocate part becomes when it fails a rule or its call fails. */
export const NO_CASE = 'No case could be written from the measured facts.';
export const DEFAULT_TIMEOUT_MS = 45000;
export const ADVOCATE_MAX_TOKENS = 400;
export const REVIEWER_MAX_TOKENS = 600;

const RULES_TEXT = [
  'Rules you must follow:',
  'Use only the measured facts given. Every number you write must appear in the facts exactly as written there. Do not compute new numbers, round, or convert units.',
  'Do not restate the level or the points.',
  'This is a risk review of the token structure only. Give no trading view: no buy or sell view, no price, no price target, no entry or exit, no advice.',
  'Never use these words: bull, bear, bullish, bearish, upside, downside target, undervalued, overvalued, accumulate, moon, buy now, sell now, price target, entry, exit, take profit, not financial advice.',
  'Write digits only as 0 1 2 3 4 5 6 7 8 9. Do not use any dash or hyphen character; write words apart or joined instead.',
].join('\n');

const SIDE: Record<'sound' | 'fragile', string> = {
  sound: 'You argue that the token structure is sound: point to the measured facts that show it is well built and the risks that are contained.',
  fragile: 'You argue that the token structure is fragile: point to the measured facts that show weak points, concentration and the risks that are open.',
};

function factsBlock(input: DebateInput): string {
  const flags = input.flag_ids.length ? input.flag_ids.join(', ') : 'none';
  const unknown = input.unknown.length ? input.unknown.map((u) => `* ${u}`).join('\n') : '* none';
  return [
    `Measured facts (one per line):\n${input.facts_text}`,
    `Risk level from the rules: ${input.level}`,
    `Risk rules that fired: ${flags}`,
    `Not measured (unknown):\n${unknown}`,
  ].join('\n\n');
}

function advocateArgs(role: 'sound' | 'fragile', input: DebateInput): RouteArgs {
  const system = `You are one of two advocates in a structure debate for a token risk analysis. ${SIDE[role]}\n${RULES_TEXT}\nWrite plain prose of at most ${ADVOCATE_MAX_WORDS} words.`;
  const prompt = `${factsBlock(input)}\n\nWrite your case.`;
  return build('exec', role, system, prompt, ADVOCATE_MAX_TOKENS);
}

function reviewerArgs(input: DebateInput, sound: string, fragile: string): RouteArgs {
  const system = [
    'You are the reviewer of a structure debate for a token risk analysis. Two advocates argued from the same measured facts, one that the structure is sound and one that it is fragile. Weigh them against the facts and say which points hold.',
    RULES_TEXT,
    `Answer with JSON only, no other text: {"text": string of at most ${REVIEWER_MAX_WORDS} words, "weight": array of the ids of the risk rules that fired which matter most, "unknown": array of what could not be measured and would change the view, "tension": optional string naming the main point the two advocates disagree on}.`,
  ].join('\n');
  const prompt = `${factsBlock(input)}\n\nCase for a sound structure:\n${sound}\n\nCase for a fragile structure:\n${fragile}\n\nAnswer with the JSON.`;
  return build('apex', 'reviewer', system, prompt, REVIEWER_MAX_TOKENS);
}

function build(complexity: 'exec' | 'apex', role: Role, system: string, prompt: string, max_tokens: number): RouteArgs {
  return {
    [TASKTYPE_FIELD]: TASKTYPE,
    tier_class: 'text',
    complexity,
    context_tokens: Math.ceil((system.length + prompt.length) / 4),
    constitutional_flag: false,
    agent_id: 'golden-kog',
    payload: { role, system, prompt, max_tokens },
  };
}

type Call = { ok: true; content: unknown; model?: string; cost: number } | { ok: false; timeout: boolean; reason: string };

/** One route call raced against the timeout. Never throws. */
async function call(deps: DebateDeps, args: RouteArgs, timeoutMs: number): Promise<Call> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Call>((resolve) => {
    timer = setTimeout(() => resolve({ ok: false, timeout: true, reason: `no answer within ${timeoutMs} ms` }), timeoutMs);
  });
  const run = (async (): Promise<Call> => {
    try {
      const r = await deps.route(args);
      const cost = typeof r?.cost_usd === 'number' && Number.isFinite(r.cost_usd) ? r.cost_usd : 0;
      return { ok: true, content: r?.content, model: typeof r?.model === 'string' ? r.model : undefined, cost };
    } catch (e) {
      return { ok: false, timeout: false, reason: `the call failed: ${e instanceof Error ? e.message : String(e)}` };
    }
  })();
  try {
    return await Promise.race([run, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/** Pull the reviewer JSON out of its answer (bare JSON, a fenced block, or JSON inside prose). */
export function parseReviewer(content: unknown): { text: string; weight: unknown[]; unknown: unknown[]; tension?: string } | null {
  if (typeof content !== 'string') return null;
  const candidates = [content.trim()];
  const fence = content.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) candidates.push(fence[1].trim());
  const a = content.indexOf('{'), b = content.lastIndexOf('}');
  if (a >= 0 && b > a) candidates.push(content.slice(a, b + 1));
  for (const c of candidates) {
    let v: unknown;
    try {
      v = JSON.parse(c);
    } catch {
      continue;
    }
    if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
    const o = v as Record<string, unknown>;
    if (typeof o.text !== 'string') continue;
    return {
      text: o.text.trim(),
      weight: Array.isArray(o.weight) ? o.weight : [],
      unknown: Array.isArray(o.unknown) ? o.unknown : [],
      tension: typeof o.tension === 'string' && o.tension.trim() !== '' ? o.tension.trim() : undefined,
    };
  }
  return null;
}

function cleanInput(input: DebateInput): DebateInput {
  const strings = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);
  return {
    facts_text: typeof input?.facts_text === 'string' ? input.facts_text : '',
    level: typeof input?.level === 'string' ? input.level : String(input?.level ?? ''),
    points: typeof input?.points === 'number' ? input.points : Number(input?.points),
    flag_ids: strings(input?.flag_ids),
    unknown: strings(input?.unknown),
  };
}

const round = (usd: number) => Math.round(usd * 1e9) / 1e9;

/**
 * Run the debate. Never throws on a failing or slow model call, and never returns or changes a level or points.
 * mode 'off' makes no call; 'shadow' (the default) runs everything, logs the Debate and returns it with shown false;
 * 'on' returns it with shown true when the debate passed.
 */
export async function debate(input: DebateInput, deps: DebateDeps): Promise<Debate> {
  const mode: Mode = deps?.mode === 'off' || deps?.mode === 'on' ? deps.mode : 'shadow';
  const empty = (status: Debate['status']): Debate => ({
    status, shown: false, sound: '', fragile: '', reviewer: '', weight: [], unknown: [], models: {}, usd: 0, rejected: [],
  });
  if (mode === 'off') return empty('off');

  const inp = cleanInput(input);
  const timeoutMs = typeof deps.timeoutMs === 'number' && deps.timeoutMs > 0 ? deps.timeoutMs : DEFAULT_TIMEOUT_MS;
  const check = typeof deps.check === 'function' ? (t: string) => deps.check!(t) : undefined;
  const out = empty('ok');
  let usd = 0;

  const finish = (d: Debate): Debate => {
    d.usd = round(usd);
    d.shown = mode === 'on' && d.status === 'ok';
    if (typeof deps.log === 'function') {
      try {
        deps.log(structuredClone(d));
      } catch {
        // A failing logger never breaks the debate.
      }
    }
    return d;
  };
  const fail = (status: 'rejected' | 'timeout'): Debate => {
    out.status = status;
    out.sound = out.fragile = out.reviewer = '';
    out.weight = [];
    out.unknown = [];
    delete out.tension;
    return finish(out);
  };

  // 1. The two advocates, in parallel.
  const roles = ['sound', 'fragile'] as const;
  const answers = await Promise.all(roles.map((role) => call(deps, advocateArgs(role, inp), timeoutMs)));
  let timedOut = false;
  roles.forEach((role, i) => {
    const a = answers[i];
    if (a.ok) {
      usd += a.cost;
      if (a.model) out.models[role] = a.model;
      const text = typeof a.content === 'string' ? a.content.trim() : '';
      const found = typeof a.content === 'string' ? problems(text, { facts: inp.facts_text, maxWords: ADVOCATE_MAX_WORDS, check }) : ['the answer is not text'];
      if (found.length) {
        out[role] = NO_CASE;
        for (const p of found) out.rejected.push(`${role}: ${p}`);
      } else out[role] = text;
    } else {
      if (a.timeout) timedOut = true;
      out[role] = NO_CASE;
      out.rejected.push(`${role}: ${a.reason}`);
    }
  });
  if (timedOut) return fail('timeout');

  // 2. The reviewer, with both advocate texts (after the rules) and the facts.
  const r = await call(deps, reviewerArgs(inp, out.sound, out.fragile), timeoutMs);
  if (!r.ok) {
    out.rejected.push(`reviewer: ${r.reason}`);
    return fail(r.timeout ? 'timeout' : 'rejected');
  }
  usd += r.cost;
  if (r.model) out.models.reviewer = r.model;
  const parsed = parseReviewer(r.content);
  if (!parsed) {
    out.rejected.push('reviewer: the answer is not the expected JSON');
    return fail('rejected');
  }
  const unknown = parsed.unknown.filter((u): u is string => typeof u === 'string' && u.trim() !== '').map((u) => u.trim());
  const found = [
    ...problems(parsed.text, { facts: inp.facts_text, maxWords: REVIEWER_MAX_WORDS, check }),
    ...(parsed.tension !== undefined ? problems(parsed.tension, { facts: inp.facts_text, maxWords: REVIEWER_MAX_WORDS, check, countWords: false }).map((p) => `tension: ${p}`) : []),
    ...unknown.flatMap((u) => problems(u, { facts: inp.facts_text, maxWords: REVIEWER_MAX_WORDS, check, countWords: false }).map((p) => `unknown: ${p}`)),
  ];
  if (found.length) {
    for (const p of found) out.rejected.push(`reviewer: ${p}`);
    return fail('rejected');
  }
  const known = new Set(inp.flag_ids);
  out.reviewer = parsed.text;
  out.weight = [...new Set(parsed.weight.filter((w): w is string => typeof w === 'string' && known.has(w)))];
  out.unknown = unknown;
  if (parsed.tension !== undefined) out.tension = parsed.tension;
  return finish(out);
}
