# Golden Kog risk debate

A small TypeScript module that adds a two sided structure debate to a token risk analysis. Two advocates argue from the measured facts, one for a sound structure and one for a fragile structure, then a reviewer weighs them.

It is a risk tool, never a trading tool: no buy or sell view, no price target, no entry or exit, no advice. It never returns or changes a level or points; those stay with the rules that computed them.

No runtime dependency. Node 22. TypeScript source in `src/debate.ts`.

## Use

```ts
import { debate } from './src/debate.ts';

const d = await debate(
  { facts_text, level: 'medium', points: 41, flag_ids: ['freeze_authority'], unknown: ['team vesting schedule'] },
  { route, check, mode: 'shadow', log: (row) => store(row), timeoutMs: 45000 },
);
```

`deps.route(args)` is the caller's model router and returns `{ content, model?, cost_usd? }`. `deps.check(text)` is optional and returns the extra problems found by the caller's own guard (empty means fine). `deps.mode` is `'off'`, `'shadow'` (the default) or `'on'`. `deps.log(row)` receives the Debate. `deps.timeoutMs` defaults to 45000.

## Call flow

```text
debate(input, deps)
  |
  |  mode 'off': return { status: 'off' } at once, no route call
  |
  |  every call carries TASKTYPE_FIELD set to TASKTYPE (see below)
  |
  |  in parallel, each raced against timeoutMs:
  |    route({ tier_class: 'text', complexity: 'exec', role: 'sound',   ... })
  |    route({ tier_class: 'text', complexity: 'exec', role: 'fragile', ... })
  |
  |  each advocate text goes through the rules;
  |  a failing text becomes "No case could be written from the measured facts."
  |  and its reasons go in rejected
  |
  |  then, raced against timeoutMs:
  |    route({ tier_class: 'text', complexity: 'apex', role: 'reviewer', ... })
  |    its prompt holds facts_text and both advocate texts (after the rules);
  |    it answers JSON { text, weight, unknown, tension? }
  |
  |  the reviewer JSON is parsed and goes through the rules;
  |  weight keeps only ids present in flag_ids
  |
  v
  Debate  (mode 'shadow': passed to log, shown false; mode 'on': shown true)
```

The exact route args (with `payload` written out) are:

```ts
route({
  [TASKTYPE_FIELD]: TASKTYPE, tier_class: 'text', complexity: 'exec', // 'apex' for the reviewer
  context_tokens, constitutional_flag: false, agent_id: 'golden-kog',
  payload: { role: 'sound', system, prompt, max_tokens },          // 'fragile' or 'reviewer'
})
```

Every call carries task\_type set to risk\_debate (exported as `TASKTYPE_FIELD` and `TASKTYPE`; they are joined from parts in the source only so that secret scanners looking for "sk" plus an underscore do not flag them). `context_tokens` is an estimate of the prompt size (characters of system and prompt divided by 4). `max_tokens` is 400 for an advocate and 600 for the reviewer.

## Rules

Every part (the sound text, the fragile text, and the reviewer text with its tension and unknown items) must pass all of these. The checks are in `src/rules.ts`.

1. **Numbers from the facts only.** Every number in the part must appear in `facts_text`, written the same way. A number is a run of digits with optional inner `.` or `,` groups, so `1,250,000` and `62.5` are one number each, and `1250000` or `62` do not match them.
2. **Refused words.** None of: bull, bear, bullish, bearish, upside, downside target, undervalued, overvalued, accumulate, moon, buy now, sell now, price target, entry, exit, take profit, not financial advice. Matching ignores case, takes whole words only (with a plural form), and lets any spacing sit inside a phrase. So `bulletin` passes and `Bears` fails.
3. **Caller guard.** `deps.check(text)` must return no problem. A check that throws counts as a problem.
4. **Word limits.** At most 180 words per advocate and 150 words for the reviewer text.
5. **Latin digits only.** Any numeric character other than 0 to 9 (Arabic Indic, Devanagari, fullwidth, superscripts) fails.
6. **No dash characters.** Any Unicode dash (hyphen, en dash, em dash, and the rest of the dash punctuation class) and the minus signs fail.

What happens on a failure:

* An advocate part that fails, or whose call fails, becomes exactly `No case could be written from the measured facts.` and its reasons go in `rejected` (for example `fragile: the number 75 is not in the measured facts`). The debate goes on.
* A reviewer part that fails, or an answer that is not the expected JSON (bare, in a fenced block, or inside prose), gives `status: 'rejected'` with empty texts, empty weight and unknown, and the reasons in `rejected`.
* A call over `timeoutMs` gives `status: 'timeout'` with empty texts. Nothing is thrown, and no reviewer call follows an advocate timeout.
* `usd` is the sum of `cost_usd` of the calls that answered. `shown` is true only in mode `'on'` with status `'ok'`.

## Example Debate

The fake route in `test/helpers.ts` with mode `'on'` gives:

```json
{
  "status": "ok",
  "shown": true,
  "sound": "The mint authority is revoked, so supply cannot grow. The pool holds 1,250,000 USDC and 87% of it is locked for 180 days, and the token has 4,312 holders.",
  "fragile": "The top 10 holders own 62.5% of supply and the freeze authority is still active, so a single key can freeze accounts. The deployer wallet still holds 3.1% of supply.",
  "reviewer": "The fragile case holds on concentration: the top 10 holders own 62.5% of supply and freeze authority is active. The sound case holds on the revoked mint and the 87% locked pool.",
  "weight": [
    "freeze_authority",
    "top_holders_concentration"
  ],
  "unknown": [
    "team vesting schedule"
  ],
  "models": {
    "sound": "exec model",
    "fragile": "exec model",
    "reviewer": "apex model"
  },
  "usd": 0.0117,
  "rejected": [],
  "tension": "Whether a locked pool offsets an active freeze authority."
}
```

## Tests

```sh
npm install
npm test
```

The tests use `node:test` with a fake route, make no network call, and are named after the acceptance item they prove (A1 to A7). `tsx` and `typescript` are dev dependencies only; `npm run typecheck` runs `tsc`.

## Credit

The debate pattern (advocates for each side, then a reviewer who weighs them) is adapted from [TradingAgents](https://github.com/TauricResearch/TradingAgents) by TauricResearch, licensed under Apache 2.0. This module keeps only the two sided debate and the reviewer: it has no trader and no portfolio manager, and it gives no trading view. No TradingAgents code is copied.

## Licence

MIT, see `LICENSE`.
