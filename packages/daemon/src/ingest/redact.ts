/**
 * Strip obvious secrets before transcript text leaves the machine (ADR 0003).
 * Conservative by design: false positives cost a word, false negatives leak a key.
 */
const PATTERNS: [RegExp, string][] = [
  [/sk-ant-[A-Za-z0-9_-]{20,}/g, "[redacted:anthropic-key]"],
  [/sk-[A-Za-z0-9]{32,}/g, "[redacted:api-key]"],
  [/gh[pousr]_[A-Za-z0-9]{30,}/g, "[redacted:github-token]"],
  [/xox[abprs]-[A-Za-z0-9-]{10,}/g, "[redacted:slack-token]"],
  [/AKIA[0-9A-Z]{16}/g, "[redacted:aws-key]"],
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    "[redacted:private-key]",
  ],
  [/\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})\b/g, "[redacted:jwt]"],
  [
    /\b((?:api[_-]?key|secret|password|passwd|token)\s*[:=]\s*)(["']?)[^\s"']{8,}\2/gi,
    "$1[redacted]",
  ],
];

export function redact(text: string): string {
  return PATTERNS.reduce((t, [re, sub]) => t.replace(re, sub), text);
}
