/**
 * Local search engine for Mizyun Account settings.
 *
 * Provides fast, zero-dependency, normalized search over settings catalog items.
 * Evaluates exact labels, curated intent phrases, aliases, and distinctive token overlap
 * with conservative typo tolerance. Deduplicates by destination key and strictly rejects
 * unrelated prose.
 */

import type { SettingsCatalogItem } from "./settings-catalog";

export interface SettingsSearchResult {
  readonly item: SettingsCatalogItem;
  readonly score: number;
  readonly matchReason:
    "exact-label" | "exact-intent" | "alias" | "token-overlap" | "fuzzy";
}

/**
 * Normalizes text for search indexing and querying:
 * - Trims and lowercases.
 * - Strips diacritics / accents.
 * - Preserves apostrophes in contractions (e.g. "don't" -> "dont").
 * - Replaces other punctuation with spaces.
 * - Collapses whitespace.
 */
export function normalizeSearchText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Weak generic stop words that carry no distinctive intent in settings queries.
 *
 * NOTE: Meaningful negation and control terms like "dont", "not", "stop", "never",
 * "no", "off" are explicitly EXCLUDED from this set so they remain distinctive.
 */
const STOP_WORDS = new Set<string>([
  "a",
  "an",
  "the",
  "i",
  "me",
  "my",
  "myself",
  "we",
  "us",
  "our",
  "ours",
  "you",
  "your",
  "yours",
  "yourself",
  "he",
  "him",
  "his",
  "she",
  "her",
  "hers",
  "it",
  "its",
  "they",
  "them",
  "their",
  "theirs",
  "what",
  "which",
  "who",
  "whom",
  "this",
  "that",
  "these",
  "those",
  "am",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "having",
  "do",
  "does",
  "did",
  "doing",
  "would",
  "should",
  "could",
  "im",
  "youre",
  "hes",
  "shes",
  "theyre",
  "can",
  "will",
  "shall",
  "may",
  "might",
  "must",
  "to",
  "of",
  "in",
  "on",
  "at",
  "by",
  "for",
  "with",
  "about",
  "against",
  "between",
  "into",
  "through",
  "during",
  "before",
  "after",
  "above",
  "below",
  "from",
  "up",
  "down",
  "out",
  "over",
  "under",
  "again",
  "further",
  "then",
  "once",
  "here",
  "there",
  "when",
  "where",
  "why",
  "how",
  "all",
  "any",
  "both",
  "each",
  "few",
  "more",
  "most",
  "other",
  "some",
  "such",
  "than",
  "too",
  "very",
  "s",
  "t",
  "just",
  "and",
  "but",
  "if",
  "or",
  "because",
  "as",
  "until",
  "while",
  // Common action verbs & generic UI filler words
  "change",
  "set",
  "update",
  "edit",
  "modify",
  "switch",
  "adjust",
  "view",
  "show",
  "open",
  "go",
  "get",
  "see",
  "look",
  "turn",
  "make",
  "take",
  "app",
  "application",
  "setting",
  "settings",
  "option",
  "options",
  "preference",
  "preferences",
  "please",
  "help",
  "want",
  "need",
  "like",
  "find",
]);

/**
 * Fast Damerau-Levenshtein distance (insertions, deletions, substitutions,
 * and adjacent transpositions) with flat TypedArray allocation and early exit.
 */
export function damerauLevenshtein(
  a: string,
  b: string,
  maxBound = Infinity,
): number {
  if (a === b) return 0;
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;
  if (Math.abs(aLen - bLen) > maxBound) return Infinity;

  const rowSize = bLen + 1;
  const d = new Int32Array((aLen + 1) * rowSize);

  for (let i = 0; i <= aLen; i++) {
    d[i * rowSize] = i;
  }
  for (let j = 0; j <= bLen; j++) {
    d[j] = j;
  }

  for (let i = 1; i <= aLen; i++) {
    const iRow = i * rowSize;
    const prevIRow = (i - 1) * rowSize;
    const prev2IRow = (i - 2) * rowSize;
    const aChar = a.charCodeAt(i - 1);

    for (let j = 1; j <= bLen; j++) {
      const cost = aChar === b.charCodeAt(j - 1) ? 0 : 1;
      let min = d[prevIRow + j] + 1; // deletion
      const ins = d[iRow + j - 1] + 1; // insertion
      if (ins < min) min = ins;
      const sub = d[prevIRow + j - 1] + cost; // substitution
      if (sub < min) min = sub;

      // Adjacent Transposition
      if (
        i > 1 &&
        j > 1 &&
        aChar === b.charCodeAt(j - 2) &&
        a.charCodeAt(i - 2) === b.charCodeAt(j - 1)
      ) {
        const trans = d[prev2IRow + j - 2] + 1;
        if (trans < min) min = trans;
      }

      d[iRow + j] = min;
    }
  }

  const result = d[aLen * rowSize + bLen];
  return result <= maxBound ? result : Infinity;
}

/**
 * Conservative typo threshold:
 * - Length < 4: 0 typos (no typos allowed for short codes like kg, lb, ai)
 * - Length 4-6: <= 1 edit (e.g. "drak" -> "dark")
 * - Length >= 7: <= 2 edits (e.g. "remidners" -> "reminders")
 */
function maxAllowedDistance(length: number): number {
  if (length < 4) return 0;
  if (length <= 6) return 1;
  return 2;
}

function isFuzzyWordMatch(queryWord: string, targetWord: string): boolean {
  if (queryWord === targetWord) return true;
  const minLen = Math.min(queryWord.length, targetWord.length);
  const allowed = maxAllowedDistance(minLen);
  if (allowed === 0) return false;
  return damerauLevenshtein(queryWord, targetWord, allowed) <= allowed;
}

interface ScoredMatch {
  readonly item: SettingsCatalogItem;
  readonly score: number;
  readonly matchReason: SettingsSearchResult["matchReason"];
}

/**
 * Searches the settings catalog using multi-tier heuristic ranking.
 */
export function searchSettings(
  query: string,
  availableItems: readonly SettingsCatalogItem[],
): readonly SettingsSearchResult[] {
  const qNorm = normalizeSearchText(query);
  if (!qNorm) {
    return [];
  }

  const qTokens = qNorm.split(" ").filter(Boolean);
  const qDistinctive = qTokens.filter((token) => !STOP_WORDS.has(token));
  const hasDistinctiveTokens = qDistinctive.length > 0;

  const matches: ScoredMatch[] = [];

  for (const item of availableItems) {
    const labelNorm = normalizeSearchText(item.label);
    const aliasesNorm = item.aliases.map(normalizeSearchText);
    const intentPhrasesNorm = item.intentPhrases.map(normalizeSearchText);
    const keywordsNorm = (item.keywords ?? []).map(normalizeSearchText);
    const descriptionNorm = normalizeSearchText(item.description);

    let bestScore = 0;
    let bestReason: SettingsSearchResult["matchReason"] = "token-overlap";

    // ── Tier 1: Exact label match (Score 1000) ──
    if (qNorm === labelNorm) {
      bestScore = 1000;
      bestReason = "exact-label";
    }

    // ── Tier 2: Exact or high-similarity intent phrase match (Score 820-900) ──
    if (bestScore < 900) {
      for (const phrase of intentPhrasesNorm) {
        if (qNorm === phrase) {
          bestScore = 900;
          bestReason = "exact-intent";
          break;
        }
        // Substring matching requires distinctive query tokens to prevent
        // stop-word phrases like "what is my" from falsely matching "what is my user id"
        if (
          hasDistinctiveTokens &&
          qNorm.length >= 6 &&
          phrase.length >= 6 &&
          (qNorm.includes(phrase) || phrase.includes(qNorm))
        ) {
          // Check that at least one distinctive query token is present in the phrase
          const phraseTokens = new Set(phrase.split(" ").filter(Boolean));
          const hasDistinctiveOverlap = qDistinctive.some((t) =>
            phraseTokens.has(t),
          );
          if (hasDistinctiveOverlap) {
            const score = 820;
            if (score > bestScore) {
              bestScore = score;
              bestReason = "exact-intent";
            }
          }
        }
      }
    }

    // ── Tier 3: Alias match (Score 650-750) ──
    if (bestScore < 750) {
      for (const alias of aliasesNorm) {
        if (qNorm === alias) {
          if (750 > bestScore) {
            bestScore = 750;
            bestReason = "alias";
          }
          break;
        }
        if (
          hasDistinctiveTokens &&
          qNorm.length >= 4 &&
          alias.length >= 4 &&
          (qNorm.startsWith(alias) || alias.startsWith(qNorm))
        ) {
          if (650 > bestScore) {
            bestScore = 650;
            bestReason = "alias";
          }
        }
      }
    }

    // ── Tier 4: Label prefix or substring (Score 550) ──
    if (bestScore < 550 && hasDistinctiveTokens) {
      if (
        qNorm.length >= 3 &&
        (labelNorm.startsWith(qNorm) || labelNorm.includes(qNorm))
      ) {
        bestScore = 550;
        bestReason = "token-overlap";
      }
    }

    // ── Tier 5: Fuzzy match on whole query vs alias / intent / label (Score 460-500) ──
    if (bestScore < 500 && qNorm.length >= 4 && hasDistinctiveTokens) {
      // Check aliases for fuzzy match (e.g. "drak mode" -> "dark mode")
      for (const alias of aliasesNorm) {
        const allowed = maxAllowedDistance(
          Math.min(qNorm.length, alias.length),
        );
        if (allowed > 0 && Math.abs(qNorm.length - alias.length) <= allowed) {
          const dist = damerauLevenshtein(qNorm, alias, allowed);
          if (dist > 0 && dist <= allowed) {
            const score = 500 - dist * 20;
            if (score > bestScore) {
              bestScore = score;
              bestReason = "fuzzy";
            }
          }
        }
      }

      // Check intent phrases for fuzzy match
      for (const phrase of intentPhrasesNorm) {
        const allowed = maxAllowedDistance(
          Math.min(qNorm.length, phrase.length),
        );
        if (allowed > 0 && Math.abs(qNorm.length - phrase.length) <= allowed) {
          const dist = damerauLevenshtein(qNorm, phrase, allowed);
          if (dist > 0 && dist <= allowed) {
            const score = 490 - dist * 20;
            if (score > bestScore) {
              bestScore = score;
              bestReason = "fuzzy";
            }
          }
        }
      }

      // Check label for fuzzy match
      const labelAllowed = maxAllowedDistance(
        Math.min(qNorm.length, labelNorm.length),
      );
      if (
        labelAllowed > 0 &&
        Math.abs(qNorm.length - labelNorm.length) <= labelAllowed
      ) {
        const dist = damerauLevenshtein(qNorm, labelNorm, labelAllowed);
        if (dist > 0 && dist <= labelAllowed) {
          const score = 480 - dist * 20;
          if (score > bestScore) {
            bestScore = score;
            bestReason = "fuzzy";
          }
        }
      }
    }

    // ── Tier 6: Distinctive token overlap & token-level fuzzy match (Score 300-450) ──
    if (bestScore < 450 && hasDistinctiveTokens) {
      // Collect all tokens from item metadata
      const labelTokens = labelNorm.split(" ").filter(Boolean);
      const aliasTokens = aliasesNorm.flatMap((a) =>
        a.split(" ").filter(Boolean),
      );
      const intentTokens = intentPhrasesNorm.flatMap((p) =>
        p.split(" ").filter(Boolean),
      );
      const keywordTokens = keywordsNorm.flatMap((k) =>
        k.split(" ").filter(Boolean),
      );
      const descTokens = descriptionNorm.split(" ").filter(Boolean);

      const allItemTokens = [
        ...labelTokens,
        ...aliasTokens,
        ...intentTokens,
        ...keywordTokens,
        ...descTokens,
      ];

      let exactMatchedTokens = 0;
      let fuzzyMatchedTokens = 0;

      for (const qToken of qDistinctive) {
        let tokenMatched = false;
        let tokenFuzzy = false;

        // Check exact or prefix match first
        for (const itemToken of allItemTokens) {
          if (
            itemToken === qToken ||
            (qToken.length >= 4 && itemToken.startsWith(qToken)) ||
            (itemToken.length >= 4 && qToken.startsWith(itemToken))
          ) {
            tokenMatched = true;
            break;
          }
        }

        // If not matched exactly, check fuzzy word match
        if (!tokenMatched && qToken.length >= 4) {
          for (const itemToken of allItemTokens) {
            if (isFuzzyWordMatch(qToken, itemToken)) {
              tokenMatched = true;
              tokenFuzzy = true;
              break;
            }
          }
        }

        if (tokenMatched) {
          if (tokenFuzzy) {
            fuzzyMatchedTokens++;
          } else {
            exactMatchedTokens++;
          }
        }
      }

      const totalMatched = exactMatchedTokens + fuzzyMatchedTokens;
      const totalDistinctive = qDistinctive.length;

      // Strict coverage requirements:
      // 1. For 1-2 distinctive terms, 100% of distinctive terms must match.
      // 2. For multi-word queries (>=2 terms), at least 1 term MUST match exactly
      //    (prevents hallucinations where every word was substituted, e.g. "bake a cake").
      // 3. For 3+ terms, at least 70% must match.
      const hasExactAnchor = totalDistinctive <= 1 || exactMatchedTokens > 0;
      const isCoverageSufficient =
        hasExactAnchor &&
        (totalDistinctive <= 2
          ? totalMatched === totalDistinctive
          : totalMatched / totalDistinctive >= 0.7);

      if (isCoverageSufficient && totalMatched > 0) {
        const isFuzzy = fuzzyMatchedTokens > 0;
        const score = (isFuzzy ? 340 : 400) + totalMatched * 15;
        if (score > bestScore) {
          bestScore = score;
          bestReason = isFuzzy ? "fuzzy" : "token-overlap";
        }
      }
    }

    if (bestScore > 0) {
      matches.push({
        item,
        score: bestScore,
        matchReason: bestReason,
      });
    }
  }

  // Deduplicate by destinationKey `${item.destinationId}:${item.anchorId ?? ""}`
  // keeping the highest scoring match.
  const bestByDestination = new Map<string, ScoredMatch>();

  for (const match of matches) {
    const destinationKey = `${match.item.destinationId}:${match.item.anchorId ?? ""}`;
    const existing = bestByDestination.get(destinationKey);
    if (!existing || match.score > existing.score) {
      bestByDestination.set(destinationKey, match);
    }
  }

  return Array.from(bestByDestination.values()).sort(
    (a, b) => b.score - a.score,
  );
}
