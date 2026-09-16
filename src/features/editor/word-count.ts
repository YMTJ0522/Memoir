export interface WordCount {
  chars: number;
  words: number;
  lines: number;
}

export function countWords(text: string): WordCount {
  if (!text) return { chars: 0, words: 0, lines: 0 };

  // 移除 front matter
  const body = text.replace(/^---\n[\s\S]*?\n---\n?/, "");

  // 字符数：非空白字符
  const chars = body.replace(/\s/g, "").length;

  // 中文字符数
  const chineseChars = (body.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;

  // 英文单词数：移除中文字符后按空格分隔
  const englishText = body.replace(/[\u4e00-\u9fff\u3400-\u4dbf]/g, " ");
  const englishWords = englishText
    .split(/\s+/)
    .filter((w) => w.length > 0 && /[a-zA-Z0-9]/.test(w)).length;

  // 总字数 = 中文字符 + 英文单词
  const words = chineseChars + englishWords;

  // 行数
  const lines = body.split("\n").length;

  return { chars, words, lines };
}

export function formatWordCount(count: WordCount): string {
  return `${count.words} 字 · ${count.chars} 字符 · ${count.lines} 行`;
}
