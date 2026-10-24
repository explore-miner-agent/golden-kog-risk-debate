import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { debate, NO_CASE, REFUSED, DEFAULT_TIMEOUT_MS, parseReviewer, TASKTYPE_FIELD, TASKTYPE, type RouteArgs, type RouteResult } from '../src/debate.ts';
import { FACTS, input, fakeRoute, SOUND, FRAGILE, REVIEW, words, never } from './helpers.ts';

// A1
test('A1 advocates sound and fragile are called in parallel, then the reviewer with both texts and the facts', async () => {
  const order: string[] = [];
  let inFlight = 0, maxInFlight = 0;
  const slow = (content: string, ms: number) => async (args: RouteArgs): Promise<RouteResult> => {
    order.push(`start ${args.payload.role}`);
    inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, ms));
    inFlight--;
    order.push(`end ${args.payload.role}`);
    return { content };
  };
  const { route, calls } = fakeRoute({ sound: slow(SOUND, 30), fragile: slow(FRAGILE, 10), reviewer: slow(JSON.stringify(REVIEW), 1) });
  const d = await debate(input(), { route, mode: 'on' });
  assert.equal(d.status, 'ok');
  assert.equal(maxInFlight, 2, 'both advocates are in flight at the same time');
  assert.deepEqual(order.slice(0, 2).sort(), ['start fragile', 'start sound']);
  assert.ok(order.indexOf('start reviewer') > order.indexOf('end sound'), 'the reviewer starts after both advocates end');
  assert.deepEqual(calls.map((c) => c.payload.role).slice(0, 2).sort(), ['fragile', 'sound']);
  assert.equal(calls[2].payload.role, 'reviewer');
  assert.equal(calls.length, 3);
  for (const c of calls) {
    assert.equal(TASKTYPE_FIELD, ['task', 'type'].join('_'));
    assert.equal(TASKTYPE, ['risk', 'debate'].join('_'));
    assert.equal(c[TASKTYPE_FIELD], TASKTYPE);
    assert.equal(c.tier_class, 'text');
    assert.equal(c.constitutional_flag, false);
    assert.equal(c.agent_id, 'golden-kog');
    assert.ok(Number.isInteger(c.context_tokens) && c.context_tokens > 0);
    assert.ok(c.payload.max_tokens > 0);
    assert.ok(c.payload.system.length > 0);
    assert.ok(c.payload.prompt.includes(FACTS), `${c.payload.role} gets the facts`);
    assert.deepEqual(Object.keys(c).sort(), ['agent_id', 'complexity', 'constitutional_flag', 'context_tokens', 'payload', TASKTYPE_FIELD, 'tier_class'].sort());
  }
  assert.equal(calls.find((c) => c.payload.role === 'sound')!.complexity, 'exec');
  assert.equal(calls.find((c) => c.payload.role === 'fragile')!.complexity, 'exec');
  assert.equal(calls[2].complexity, 'apex');
  assert.ok(calls[2].payload.prompt.includes(SOUND) && calls[2].payload.prompt.includes(FRAGILE), 'the reviewer gets both texts');
  assert.equal(d.sound, SOUND);
  assert.equal(d.fragile, FRAGILE);
  assert.equal(d.reviewer, REVIEW.text);
});

test('A1 the reviewer gets the replacement text when an advocate part failed', async () => {
  const { route, calls } = fakeRoute({ sound: { content: 'Supply is 99 percent safe.' } });
  const d = await debate(input(), { route });
  assert.equal(d.sound, NO_CASE);
  assert.ok(calls[2].payload.prompt.includes(NO_CASE));
  assert.ok(!calls[2].payload.prompt.includes('99 percent'));
});

// A2
test('A2 an advocate part with a number not in facts_text is replaced and the reason kept', async () => {
  const { route } = fakeRoute({ fragile: { content: 'The top 10 holders own 75% of supply.', cost_usd: 0.02 } });
  const d = await debate(input(), { route });
  assert.equal(d.status, 'ok');
  assert.equal(d.fragile, NO_CASE);
  assert.equal(d.sound, SOUND);
  assert.ok(d.rejected.some((r) => r.startsWith('fragile:') && r.includes('75')), d.rejected.join(' | '));
  assert.equal(d.reviewer, REVIEW.text);
});

test('A2 numbers must be written the same way as in facts_text', async () => {
  for (const bad of ['The pool holds 1250000 USDC.', 'Top holders own 62.50% of supply.', 'Holders: 4312.', 'Top holders own 62% of supply.']) {
    const { route } = fakeRoute({ sound: { content: bad } });
    const d = await debate(input(), { route });
    assert.equal(d.sound, NO_CASE, bad);
    assert.ok(d.rejected.some((r) => r.startsWith('sound:') && r.includes('not in the measured facts')), bad);
  }
  const { route } = fakeRoute({ sound: { content: 'The pool holds 1,250,000 USDC; 87% is locked for 180 days. Holders: 4,312. Top 10 own 62.5%.' } });
  const d = await debate(input(), { route });
  assert.notEqual(d.sound, NO_CASE);
  assert.deepEqual(d.rejected, []);
});

test('A2 a reviewer part with a number not in facts_text drops the debate and keeps the reason', async () => {
  const { route } = fakeRoute({ reviewer: { content: JSON.stringify({ ...REVIEW, text: 'Concentration of 70% is the main risk.' }) } });
  const d = await debate(input(), { route, mode: 'on' });
  assert.equal(d.status, 'rejected');
  assert.equal(d.shown, false);
  assert.deepEqual([d.sound, d.fragile, d.reviewer], ['', '', '']);
  assert.deepEqual(d.weight, []);
  assert.deepEqual(d.unknown, []);
  assert.ok(d.rejected.some((r) => r.startsWith('reviewer:') && r.includes('70')), d.rejected.join(' | '));
});

// A3
test('A3 each refused word makes an advocate part fail, in any case', async () => {
  for (const term of REFUSED) {
    for (const t of [term, term.toUpperCase(), term[0].toUpperCase() + term.slice(1)]) {
      const { route } = fakeRoute({ sound: { content: `The mint authority is revoked, a ${t} case.` } });
      const d = await debate(input(), { route });
      assert.equal(d.sound, NO_CASE, t);
      assert.ok(d.rejected.some((r) => r.startsWith('sound:') && r.includes(`refused word "${term}"`)), `${t}: ${d.rejected}`);
    }
  }
  for (const t of ['bulls', 'bears', 'entries', 'exits', 'buy   now']) {
    const { route } = fakeRoute({ sound: { content: `Holders see ${t} here.` } });
    assert.equal((await debate(input(), { route })).sound, NO_CASE, t);
  }
  // Whole words only: these are fine.
  const { route } = fakeRoute({ sound: { content: 'The bulletin on the bearer shares and the exited mooring was read.' } });
  assert.notEqual((await debate(input(), { route })).sound, NO_CASE);
});

test('A3 a long dash, any dash character and a non Latin digit are refused', async () => {
  const cases: [string, string][] = [
    ['The mint is revoked \u2014 supply is fixed.', 'a dash character'],
    ['The mint is revoked \u2013 supply is fixed.', 'a dash character'],
    ['The mint is revoked - supply is fixed.', 'a dash character'],
    ['A well\u2010built pool.', 'a dash character'],
    ['Supply moved by \u22123.1%.', 'a dash character'],
    ['Top \u0661\u0660 holders own a lot.', 'not a Latin digit'],
    ['Top \u0967\u0966 holders own a lot.', 'not a Latin digit'],
    ['Top \uFF11\uFF10 holders own a lot.', 'not a Latin digit'],
  ];
  for (const [text, reason] of cases) {
    const { route } = fakeRoute({ fragile: { content: text } });
    const d = await debate(input(), { route });
    assert.equal(d.fragile, NO_CASE, text);
    assert.ok(d.rejected.some((r) => r.startsWith('fragile:') && r.includes(reason)), `${text}: ${d.rejected}`);
  }
});

test('A3 an advocate part over 180 words is refused, 180 words pass', async () => {
  let r = fakeRoute({ sound: { content: words(181) } });
  let d = await debate(input(), { route: r.route });
  assert.equal(d.sound, NO_CASE);
  assert.ok(d.rejected.some((x) => x.startsWith('sound:') && x.includes('181 words')));
  r = fakeRoute({ sound: { content: words(180) } });
  d = await debate(input(), { route: r.route });
  assert.equal(d.sound, words(180));
});

test('A3 a deps.check problem refuses an advocate part and keeps the problem', async () => {
  const seen: string[] = [];
  const check = (t: string) => { seen.push(t); return t.includes('deployer wallet') ? ['mentions a guarded topic'] : []; };
  const { route } = fakeRoute();
  const d = await debate(input(), { route, check });
  assert.equal(d.sound, SOUND);
  assert.equal(d.fragile, NO_CASE);
  assert.ok(d.rejected.includes('fragile: mentions a guarded topic'));
  assert.ok(seen.includes(SOUND) && seen.includes(FRAGILE));
  // A check that throws counts as a problem, not a crash.
  const d2 = await debate(input(), { route, check: () => { throw new Error('guard down'); } });
  assert.equal(d2.status, 'rejected');
  assert.ok(d2.rejected.some((x) => x.includes('guard down')));
});

test('A3 the reviewer part is refused the same way and drops the debate', async () => {
  const bad = [
    { text: 'The fragile case is stronger; this is not a bearish call.' },
    { text: 'Freeze authority is active \u2014 that matters most.' },
    { text: 'The top \u0661\u0660 holders matter most.' },
    { text: words(151) },
    { text: 'Fine text.', tension: 'Whether to take profit.' },
    { text: 'Fine text.', unknown: ['the price target'] },
  ];
  for (const b of bad) {
    const { route } = fakeRoute({ reviewer: { content: JSON.stringify({ ...REVIEW, tension: undefined, ...b }) } });
    const d = await debate(input(), { route, mode: 'on' });
    assert.equal(d.status, 'rejected', JSON.stringify(b));
    assert.deepEqual([d.sound, d.fragile, d.reviewer], ['', '', '']);
    assert.ok(d.rejected.some((r) => r.startsWith('reviewer:')), JSON.stringify(b));
  }
  let r = fakeRoute({ reviewer: { content: JSON.stringify({ ...REVIEW, text: words(150) }) } });
  assert.equal((await debate(input(), { route: r.route })).status, 'ok');
  r = fakeRoute();
  const d = await debate(input(), { route: r.route, check: (t) => (t === REVIEW.text ? ['reviewer text flagged'] : []) });
  assert.equal(d.status, 'rejected');
  assert.ok(d.rejected.includes('reviewer: reviewer text flagged'));
});

// A4
test('A4 the reviewer JSON is parsed and weight keeps only known flag ids', async () => {
  const content = 'Here is my review:\n```json\n' + JSON.stringify({ ...REVIEW, weight: ['freeze_authority', 'made_up_rule', 'freeze_authority', 7, 'deployer_holds'] }) + '\n```';
  const { route } = fakeRoute({ reviewer: { content } });
  const d = await debate(input(), { route, mode: 'on' });
  assert.equal(d.status, 'ok');
  assert.equal(d.reviewer, REVIEW.text);
  assert.deepEqual(d.weight, ['freeze_authority', 'deployer_holds']);
  assert.deepEqual(d.unknown, ['team vesting schedule']);
  assert.equal(d.tension, REVIEW.tension);
  // No tension in the answer: no tension in the Debate.
  const r2 = fakeRoute({ reviewer: { content: JSON.stringify({ text: REVIEW.text, weight: [], unknown: [] }) } });
  const d2 = await debate(input(), { route: r2.route });
  assert.equal(d2.status, 'ok');
  assert.equal('tension' in d2, false);
  assert.deepEqual(d2.weight, []);
});

test('A4 unparseable reviewer JSON gives status rejected', async () => {
  for (const content of ['not json at all', '{"text": "unterminated', '[1,2]', JSON.stringify({ weight: ['freeze_authority'] }), JSON.stringify({ text: 5 }), '']) {
    const { route } = fakeRoute({ reviewer: { content } });
    const d = await debate(input(), { route, mode: 'on' });
    assert.equal(d.status, 'rejected', content);
    assert.equal(d.shown, false);
    assert.deepEqual([d.sound, d.fragile, d.reviewer], ['', '', '']);
    assert.ok(d.rejected.some((r) => r.startsWith('reviewer:')), content);
  }
  assert.equal(parseReviewer(null), null);
  assert.equal(parseReviewer('{"text":"ok"}')!.text, 'ok');
});

// A5
test('A5 an advocate call over timeoutMs gives status timeout without throwing', async () => {
  const { route, calls } = fakeRoute({ fragile: never });
  const t0 = Date.now();
  const d = await debate(input(), { route, timeoutMs: 50, mode: 'on' });
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(d.status, 'timeout');
  assert.equal(d.shown, false);
  assert.deepEqual([d.sound, d.fragile, d.reviewer], ['', '', '']);
  assert.ok(d.rejected.some((r) => r.startsWith('fragile:') && r.includes('50 ms')));
  assert.equal(calls.filter((c) => c.payload.role === 'reviewer').length, 0, 'no reviewer call after a timeout');
});

test('A5 a reviewer call over timeoutMs gives status timeout; the default timeout is 45000 ms', async () => {
  const { route } = fakeRoute({ reviewer: never });
  const d = await debate(input(), { route, timeoutMs: 40 });
  assert.equal(d.status, 'timeout');
  assert.ok(d.rejected.some((r) => r.startsWith('reviewer:')));
  assert.equal(d.usd, 0.03, 'the two advocate calls still count');
  assert.equal(DEFAULT_TIMEOUT_MS, 45000);
  // A call that throws is a failed part, never a thrown debate.
  const r2 = fakeRoute({ sound: new Error('upstream 500') });
  const d2 = await debate(input(), { route: r2.route });
  assert.equal(d2.status, 'ok');
  assert.equal(d2.sound, NO_CASE);
  assert.ok(d2.rejected.some((r) => r.includes('upstream 500')));
  const r3 = fakeRoute({ reviewer: new Error('upstream 500') });
  assert.equal((await debate(input(), { route: r3.route })).status, 'rejected');
});

// A6
test('A6 mode off makes no route call', async () => {
  const { route, calls } = fakeRoute();
  const logged: object[] = [];
  const d = await debate(input(), { route, mode: 'off', log: (r) => logged.push(r) });
  assert.equal(calls.length, 0);
  assert.equal(d.status, 'off');
  assert.equal(d.shown, false);
  assert.equal(d.usd, 0);
});

test('A6 mode shadow (the default) runs everything, logs the Debate and returns shown false', async () => {
  for (const mode of ['shadow', undefined] as const) {
    const { route, calls } = fakeRoute();
    const logged: object[] = [];
    const d = await debate(input(), { route, mode, log: (r) => logged.push(r) });
    assert.equal(calls.length, 3);
    assert.equal(d.status, 'ok');
    assert.equal(d.shown, false);
    assert.equal(logged.length, 1);
    assert.deepEqual(logged[0], d);
  }
  // A logger that throws does not break the debate.
  const { route } = fakeRoute();
  assert.equal((await debate(input(), { route, log: () => { throw new Error('disk full'); } })).status, 'ok');
});

test('A6 mode on returns shown true; usd sums the calls; models are kept', async () => {
  const { route } = fakeRoute();
  const d = await debate(input(), { route, mode: 'on' });
  assert.equal(d.shown, true);
  assert.equal(d.usd, 0.06);
  assert.deepEqual(d.models, { sound: 'model-exec-a', fragile: 'model-exec-b', reviewer: 'model-apex' });
  const r2 = fakeRoute({ sound: { content: SOUND }, reviewer: { content: JSON.stringify(REVIEW), cost_usd: 0.125 } });
  assert.equal((await debate(input(), { route: r2.route, mode: 'on' })).usd, 0.145);
});

test('A6 the debate never returns or changes a level or points', async () => {
  const inp = input();
  const before = structuredClone(inp);
  const { route } = fakeRoute();
  const d = await debate(inp, { route, mode: 'on' });
  assert.deepEqual(inp, before);
  assert.equal('level' in d, false);
  assert.equal('points' in d, false);
  assert.deepEqual(Object.keys(d).sort(), ['fragile', 'models', 'rejected', 'reviewer', 'shown', 'sound', 'status', 'tension', 'unknown', 'usd', 'weight']);
});

// A7
test('A7 the README shows the call flow, the rules, an example Debate, and credits TradingAgents', () => {
  const md = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(md, /## Call flow/);
  assert.match(md, /route\(\{.*role: 'sound'/s);
  assert.match(md, /## Rules/);
  for (const w of ['180 words', '150 words', 'Latin digits', 'dash', 'deps.check', 'facts_text']) assert.ok(md.includes(w), w);
  for (const term of REFUSED) assert.ok(md.includes(term), term);
  assert.match(md, /## Example Debate/);
  const ex = md.match(/## Example Debate[\s\S]*?```json\n([\s\S]*?)```/);
  assert.ok(ex, 'an example Debate in a json block');
  const example = JSON.parse(ex![1]);
  for (const k of ['status', 'shown', 'sound', 'fragile', 'reviewer', 'weight', 'unknown', 'models', 'usd', 'rejected']) assert.ok(k in example, k);
  assert.match(md, /TradingAgents/);
  assert.match(md, /TauricResearch/);
  assert.match(md, /Apache 2\.0/);
  assert.ok(!/[\u2013\u2014]/.test(md), 'no long dashes in the README');
});
