/** Scores are stored as exact thirds. UI rounding must never affect ranking. */
export interface Fraction { numerator: number; denominator: 3 }
export interface Score { base: number; bonus: number; total: number }
function integer(value: number): void {
  if (!Number.isSafeInteger(value)) throw new RangeError('SAFE_INTEGER_REQUIRED');
}
export function sentenceScore(count: number): Score {
  integer(count);
  if (count < 2) throw new RangeError('INVALID_SENTENCE_SIZE');
  const bonus = count <= 3 ? 0 : count <= 5 ? 1 : 3;
  const total = count + bonus;
  integer(total);
  return {base: count, bonus, total};
}
export function finalScore(sentencePoints: number, ratingSum: number, remainingTiles: number): Fraction {
  [sentencePoints, ratingSum, remainingTiles].forEach(integer);
  if (sentencePoints < 0 || ratingSum < 0 || remainingTiles < 0) throw new RangeError('NEGATIVE_SCORE_COMPONENT');
  const numerator = 3 * (sentencePoints - remainingTiles) + ratingSum;
  integer(numerator);
  return {numerator, denominator: 3};
}
export function ranking(players: readonly string[], totals: Readonly<Record<string, number>>) {
  if (new Set(players).size !== players.length) throw new RangeError('DUPLICATE_PLAYER');
  for (const player of players) {
    if (!Object.hasOwn(totals, player)) throw new RangeError('MISSING_TOTAL');
    integer(totals[player]);
  }
  const ordered = players.map((player, seat) => ({player, seat, score: totals[player]}))
    .sort((a, b) => b.score - a.score || a.seat - b.seat);
  let rank = 0;
  return ordered.map((entry, index) => {
    if (index === 0 || entry.score !== ordered[index - 1].score) rank = index + 1;
    return {player_id: entry.player, rank, total: {numerator: entry.score, denominator: 3 as const}};
  });
}
