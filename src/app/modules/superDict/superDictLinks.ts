function normalizeQuery(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

function encodeQuery(value: string): string {
  return encodeURIComponent(normalizeQuery(value));
}

export function normalizeLookupQuery(value: string): string {
  return normalizeQuery(value);
}

export function buildLookupUrls(query: string): Record<string, string> {
  const encoded = encodeQuery(query);
  if (!encoded) {
    return {
      cambridge: "https://dictionary.cambridge.org/",
      oxford: "https://www.oxfordlearnersdictionaries.com/",
      longman: "https://www.ldoceonline.com/",
      collins: "https://www.collinsdictionary.com/",
      "google-images": "https://www.google.com/search?tbm=isch",
      "bing-images": "https://www.bing.com/images",
      "baidu-images": "https://image.baidu.com/",
      youglish: "https://youglish.com/",
    };
  }

  return {
    cambridge: `https://dictionary.cambridge.org/dictionary/english/${encoded}`,
    oxford: `https://www.oxfordlearnersdictionaries.com/definition/english/${encoded}`,
    longman: `https://www.ldoceonline.com/dictionary/${encoded}`,
    collins: `https://www.collinsdictionary.com/dictionary/english/${encoded}`,
    "google-images": `https://www.google.com/search?tbm=isch&q=${encoded}`,
    "bing-images": `https://www.bing.com/images/search?q=${encoded}`,
    "baidu-images": `https://image.baidu.com/search/index?tn=baiduimage&word=${encoded}`,
    youglish: `https://youglish.com/pronounce/${encoded}/english`,
  };
}
