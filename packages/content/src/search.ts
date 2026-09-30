export interface MemeAsset {
  key: string; kind: string; title: string; keywords: readonly string[];
}
/** Stable ranking by distinct selected glyph matches after text filtering. */
export function rankMemes<T extends MemeAsset>(assets: readonly T[], query: string, glyphs: readonly string[]) {
  const unique = [...new Set(glyphs.filter(x => x.length > 0))];
  const needle = query.trim().toLowerCase();
  return assets.flatMap((asset, index) => {
    if (asset.kind !== 'meme') return [];
    const keywords = asset.keywords.join(' ').toLowerCase();
    if (needle && !`${asset.title.toLowerCase()} ${keywords}`.includes(needle)) return [];
    const matched = unique.filter(glyph => keywords.includes(glyph.toLowerCase()));
    return [{asset, index, matched}];
  }).sort((a, b) => b.matched.length - a.matched.length || a.index - b.index)
    .map(({asset, matched}) => ({...asset, keywords: [...asset.keywords], match_count: matched.length, matched_glyphs: matched}));
}
