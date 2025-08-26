// src/modules/draft/similarity.util.ts
// n-gram 토큰화 + 자카드 유사도 (한글/영문 공용)

const normalize = (s: string) =>
    (s || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();

export function ngrams(text: string, n = 3): Set<string> {
    const t = normalize(text);
    if (!t) return new Set();
    const toks = t.split(' ');
    if (toks.length < n) return new Set();
    const grams: string[] = [];
    for (let i = 0; i <= toks.length - n; i++) {
        grams.push(toks.slice(i, i + n).join(' '));
    }
    return new Set(grams);
}

export function jaccardN(a: string, b: string, n = 3): number {
    const A = ngrams(a, n);
    const B = ngrams(b, n);
    if (A.size === 0 && B.size === 0) return 0;
    let inter = 0;
    for (const g of A) if (B.has(g)) inter++;
    const union = A.size + B.size - inter;
    if (union === 0) return 0;
    return inter / union;
}

// 3-gram 호환 alias (원래 코드와의 호환 목적)
export const jaccard3 = (a: string, b: string) => jaccardN(a, b, 3);
