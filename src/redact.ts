interface RedactPattern {
  regex: RegExp;
  replacement: string;
}

const patterns: RedactPattern[] = [
  // Bearer tokens (must come before generic JWT to catch "Bearer eyJ...")
  {
    regex: /Bearer\s+[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]*/gi,
    replacement: '[REDACTED_BEARER]',
  },
  // JWTs (three base64url segments separated by dots)
  {
    regex: /eyJ[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]{10,}\.[A-Za-z0-9\-_]*/g,
    replacement: '[REDACTED_JWT]',
  },
  // Authorization headers (skip if already redacted by Bearer pattern above)
  {
    regex: /Authorization:\s*(?!\[REDACTED)\S+/gi,
    replacement: 'Authorization: [REDACTED_AUTH]',
  },
  // AWS access keys
  {
    regex: /AKIA[0-9A-Z]{16}/g,
    replacement: '[REDACTED_AWS_KEY]',
  },
  // Password/secret key-value pairs (skip if value is already a redaction tag)
  {
    regex: /(password|passwd|secret|api_key|apikey|access_token|token)[\s]*[=:]\s*(?!\[REDACTED)\S+/gi,
    replacement: '$1=[REDACTED_SECRET]',
  },
  // Email addresses
  {
    regex: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    replacement: '[REDACTED_EMAIL]',
  },
  // Credit card numbers (13-19 digits, optionally separated by spaces or dashes)
  {
    regex: /\b(?:\d[ \-]*?){13,19}\b/g,
    replacement: '[REDACTED_CC]',
  },
];

export function redact(input: string): string {
  let result = input;
  for (const pattern of patterns) {
    result = result.replace(pattern.regex, pattern.replacement);
  }
  return result;
}
