export type CardLite = { status: string };

export function computeProgress(
  cards: CardLite[],
  quizScore: number | null,
  quizTotal: number | null,
) {
  const total = cards.length;
  const reviewed = cards.filter((c) => c.status !== "new").length;
  const mastered = cards.filter((c) => c.status === "known").length;
  const quizPct = quizScore != null && quizTotal ? Math.round((quizScore / quizTotal) * 100) : null;
  const cardPct = total ? Math.round((mastered / total) * 100) : 0;
  const overall = quizPct == null ? cardPct : Math.round((cardPct + quizPct) / 2);
  return { total, reviewed, mastered, quizPct, cardPct, overall };
}
