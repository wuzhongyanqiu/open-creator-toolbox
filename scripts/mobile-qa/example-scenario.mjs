/**
 * Minimal DOM-game scenario example; copy into the game's own scripts directory
 * and replace these test IDs with the real initial play / result / replay path.
 * It never silently skips a missing screen. Canvas games need project-specific
 * touch coordinates or game instrumentation plus screenshot review.
 *
 * Run a local preview first, then:
 * node /absolute/toolbox/scripts/mobile-qa/browser-matrix.mjs \
 *   --project /absolute/game --url http://127.0.0.1:5173 \
 *   --out /absolute/new-evidence --scenario /absolute/game/scripts/mobile-scenario.mjs
 *
 * This file intentionally fails against unrelated games until their selectors
 * and assertions are supplied; a successful page load is only a smoke test.
 */
export default async function exampleScenario({ page, profile, outputDir }) {
  const start = page.getByTestId('qa-start');
  await start.waitFor({ state: 'visible' });
  await start.tap();
  await page.getByTestId('qa-playing').waitFor({ state: 'visible' });

  const action = page.getByTestId('qa-primary-action');
  await action.tap();
  await page.getByTestId('qa-result').waitFor({ state: 'visible' });
  const resultText = (await page.getByTestId('qa-result').innerText()).trim();
  if (!resultText) throw new Error('The result screen is empty. Define a stronger project-specific score/reward assertion.');
  await page.getByTestId('qa-replay').tap();
  await page.getByTestId('qa-playing').waitFor({ state: 'visible' });

  // Capture extra steps here using outputDir if needed. The runner also records
  // initial/final screenshots and diagnostics for this exact viewport profile.
  void profile;
  void outputDir;
  return {
    checks: [
      { name: 'Visible start control accepts touch and opens play', passed: true },
      { name: 'Primary action reaches a nonempty result screen', passed: true },
      { name: 'Replay returns to play', passed: true },
    ],
    covered: ['DOM start → primary action → result → replay, in browser emulation.'],
    unverified: ['Replace example assertions with actual score/reward/storage checks.',
      'Ads, leaderboard server state, saved-game compatibility, audio, long play and visual quality.'],
  };
}
