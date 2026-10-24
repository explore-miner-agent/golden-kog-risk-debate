import type { DebateInput, RouteArgs, RouteResult } from '../src/debate.ts';

export const FACTS = [
  'Top 10 holders own 62.5% of supply',
  'Mint authority: revoked',
  'Freeze authority: active',
  'Liquidity pool: 1,250,000 USDC, 87% locked for 180 days',
  'Holders: 4,312',
  'Deployer wallet holds 3.1% of supply',
].join('\n');

export const input = (over: Partial<DebateInput> = {}): DebateInput => ({
  facts_text: FACTS,
  level: 'medium',
  points: 41,
  flag_ids: ['freeze_authority', 'top_holders_concentration', 'deployer_holds'],
  unknown: ['team vesting schedule'],
  ...over,
});

export const SOUND = 'The mint authority is revoked, so supply cannot grow. The pool holds 1,250,000 USDC and 87% of it is locked for 180 days, and the token has 4,312 holders.';
export const FRAGILE = 'The top 10 holders own 62.5% of supply and the freeze authority is still active, so a single key can freeze accounts. The deployer wallet still holds 3.1% of supply.';
export const REVIEW = {
  text: 'The fragile case holds on concentration: the top 10 holders own 62.5% of supply and freeze authority is active. The sound case holds on the revoked mint and the 87% locked pool.',
  weight: ['freeze_authority', 'top_holders_concentration'],
  unknown: ['team vesting schedule'],
  tension: 'Whether a locked pool offsets an active freeze authority.',
};

export type Answer = RouteResult | Error | ((args: RouteArgs) => Promise<RouteResult>);

/** A fake route: answers by role, records every call. */
export function fakeRoute(answers: { sound?: Answer; fragile?: Answer; reviewer?: Answer } = {}) {
  const calls: RouteArgs[] = [];
  const base = {
    sound: { content: SOUND, model: 'model-exec-a', cost_usd: 0.01 },
    fragile: { content: FRAGILE, model: 'model-exec-b', cost_usd: 0.02 },
    reviewer: { content: JSON.stringify(REVIEW), model: 'model-apex', cost_usd: 0.03 },
    ...answers,
  };
  const route = async (args: RouteArgs): Promise<RouteResult> => {
    calls.push(args);
    const a = base[args.payload.role];
    if (a instanceof Error) throw a;
    if (typeof a === 'function') return a(args);
    return a;
  };
  return { route, calls };
}

export const words = (n: number, w = 'risk') => Array.from({ length: n }, () => w).join(' ');
export const never = () => new Promise<RouteResult>(() => {});
