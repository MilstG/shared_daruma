// Playbooks: a setup's written rules, ticked per trade, and what keeping them is worth.
// Pure functions extracted from the app (app-source.js), pinned against hand-computed values.
import { t, ok, eq, near, report, makeExtractor } from './harness.mjs';
import { readAppSource } from '../app-source.js';

const html = readAppSource(new URL('../ledger.html', import.meta.url).pathname);
const { evalModule, grabFn } = makeExtractor(html);
const P = await evalModule(['pbNorm', 'pbKey', 'playbookFor', 'pbRulesFromText', 'playbookStats', 'pbGap'], null,
  'let _be = 1; const isWin = n => n > _be, isLoss = n => n < -_be;');

const BO = { id: 'pb1', name: 'Breakout retest', rules: [{ id: 'a', text: 'Wait for the retest' }, { id: 'b', text: 'Stop under the range' }], at: 1 };

console.log('\nPlaybooks: data');
t('normalizing drops junk, trims, caps rules, and keeps tombstones only when asked', () => {
  const raw = [BO, { id: 'x', name: '  ' }, null, { id: 'pb1', name: 'dup' }, { id: 'gone', del: true, at: 5 },
    { id: 'big', name: 'Big', rules: Array.from({ length: 20 }, (_, i) => ({ id: 'r' + i, text: 'rule ' + i })) }];
  eq(P.pbNorm(raw).map(p => p.id), ['pb1', 'big']);
  eq(P.pbNorm(raw)[1].rules.length, 15);
  eq(P.pbNorm(raw, true).map(p => p.id), ['pb1', 'gone', 'big']);
});
t('a trade matches a playbook by setup name, ignoring case and spacing; deleted ones never match', () => {
  eq(P.playbookFor('  breakout   RETEST ', [BO]).id, 'pb1');
  eq(P.playbookFor('breakout', [BO]), null);
  eq(P.playbookFor('', [BO]), null);
  eq(P.playbookFor('Breakout retest', [{ ...BO, del: true }]), null);
});
t('rules typed one per line keep the ids of unchanged lines, so earlier ticks still count', () => {
  let n = 0; const mk = () => 'new' + (++n);
  const r = P.pbRulesFromText('- wait for the RETEST\n\n2) Size half on Fridays\n• Stop under the range', BO.rules, mk);
  eq(r, [{ id: 'a', text: 'wait for the RETEST' }, { id: 'new1', text: 'Size half on Fridays' }, { id: 'b', text: 'Stop under the range' }]);
  eq(P.pbRulesFromText('same\nsame', [], mk).map(x => x.id), ['new2', 'new3'], 'a repeated line gets its own id');
});

console.log('\nPlaybooks: what keeping the rules is worth');
const T = (id, net) => ({ id, net, isOpen: false, closeTime: 1 });
const trades = [T('t1', 100), T('t2', 60), T('t3', -80), T('t4', -40), T('t5', 30), T('t6', 10)];
const J = {
  t1: { setup: 'Breakout retest', pb: { id: 'pb1', ok: ['a', 'b'], of: ['a', 'b'] } },
  t2: { setup: 'breakout retest', pb: { id: 'pb1', ok: ['a', 'b'], of: ['a', 'b'] } },
  t3: { setup: 'Breakout retest', pb: { id: 'pb1', ok: ['b'], of: ['a', 'b'] } },          // broke a
  t4: { setup: 'Breakout retest', pb: { id: 'pb1', ok: [], of: ['a', 'b'] } },             // broke both
  t5: { setup: 'Breakout retest' },                                                         // not checked
  t6: { setup: 'Range fade' },                                                              // another setup
};
const R = { t1: 2, t2: 1.2, t3: -1, t4: -0.5 };
const [s] = P.playbookStats(trades, J, [BO], tr => R[tr.id] ?? null);
t('counts the playbook’s trades, the checked ones, and splits kept-every-rule from broke-one', () => {
  eq([s.n, s.checked, s.kept.n, s.broke.n], [5, 4, 2, 2]);
  near(s.kept.exp, 80); near(s.broke.exp, -60); near(s.all.net, 70);
  near(s.kept.avgR, 1.6); near(s.broke.avgR, -0.75);
  eq(s.kept.wr, 1); eq(s.broke.wr, 0);
});
t('per rule: how often it was kept, and the result kept vs broken', () => {
  const [a, b] = s.rules;
  eq([a.graded, a.kept.n, a.broke.n], [4, 2, 2]); near(a.keptRate, 0.5);
  eq([b.graded, b.kept.n, b.broke.n], [4, 3, 1]); near(b.kept.exp, (100 + 60 - 80) / 3); near(b.broke.exp, -40);
});
t('the gap is in R when both sides mostly have R, else in dollars per trade', () => {
  eq(P.pbGap(s.kept, s.broke), { v: 1.6 - -0.75, unit: 'R' });
  const noR = P.playbookStats(trades, J, [BO], () => null)[0];
  eq(P.pbGap(noR.kept, noR.broke), { v: 140, unit: '$' });
  eq(P.pbGap({ n: 0 }, s.broke), null, 'no gap without both sides');
});
t('a rule added after a trade was checked doesn’t grade that trade', () => {
  const BO2 = { ...BO, rules: [...BO.rules, { id: 'c', text: 'No entries in the first 15 minutes' }] };
  const [s2] = P.playbookStats(trades, J, [BO2], () => null);
  eq(s2.rules[2].graded, 0, 'the new rule waits for new checklists');
  eq([s2.kept.n, s2.broke.n], [2, 2], 'old trades that kept every rule on their checklist still count as kept');
});
t('ticks for another playbook (the setup was renamed) are ignored', () => {
  const J2 = { ...J, t1: { setup: 'Breakout retest', pb: { id: 'other', ok: ['a', 'b'] } } };
  eq(P.playbookStats(trades, J2, [BO], () => null)[0].checked, 3);
});

console.log('\nPlaybooks: wiring');
t('playbooks sync (field-level, merged per playbook) and ride backups', () => {
  ok(html.includes("'pzLessons','pzGoals','playbooks'];"), 'synced settings field');
  ok(html.includes('playbooks:settings.playbooks}'), 'in snapshots/backups');
  ok(grabFn('_syncMerge').includes("k==='playbooks'"), 'merged by id on a conflict');
  ok(grabFn('journalRow').includes('pbChecklistHtml(t,j)'), 'the checklist shows in the trade journal');
  ok(grabFn('renderReviewInner').includes('playbooksSectionHtml()'), 'the Review tab shows the section');
});

report('playbooks');
