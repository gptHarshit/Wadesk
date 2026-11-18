/** Keyword matching for auto-replies. Pure functions, no database. */

const PRIORITY = { exact: 0, starts_with: 1, contains: 2 };

/** A rule's keyword field can hold several words separated by commas: "hi, hello, hey". */
export function splitKeywords(keyword) {
  return String(keyword ?? '')
    .split(',')
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
}

/** Tidy what was typed for storage: trimmed, empty parts and repeats dropped, letters kept as typed. */
export function tidyKeywords(keyword) {
  const seen = new Set();
  const out = [];
  for (const part of String(keyword ?? '').split(',')) {
    const k = part.trim();
    if (!k || seen.has(k.toLowerCase())) continue;
    seen.add(k.toLowerCase());
    out.push(k);
  }
  return out.join(', ');
}

// Punctuation and spaces at the ends don't change what someone meant: "Hi!" and "hi" are the same greeting.
const EDGE_PUNCTUATION = /^[\s.,!?;:'"…-]+|[\s.,!?;:'"…-]+$/g;

export function matchesRule(rule, text) {
  const value = String(text ?? '').trim().toLowerCase();
  if (!value) return false;
  const bare = value.replace(EDGE_PUNCTUATION, '');
  return splitKeywords(rule.keyword).some((keyword) => {
    if (rule.matchType === 'exact') return value === keyword || bare === keyword;
    if (rule.matchType === 'starts_with') return value.startsWith(keyword) || bare.startsWith(keyword);
    return value.includes(keyword);
  });
}

/** Pick the rule to answer with: exact matches win over "starts with", which win over "contains". */
export function pickRule(rules, text) {
  return (
    [...rules]
      .sort((a, b) => PRIORITY[a.matchType] - PRIORITY[b.matchType])
      .find((rule) => matchesRule(rule, text)) ?? null
  );
}
