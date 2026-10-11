import { digest } from './common.mjs';

const patterns = [
  ['PRIVATE_KEY', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g],
  ['GITHUB_TOKEN', /\bgh[pousr]_[A-Za-z0-9]{36,}\b|\bgithub_pat_\w{60,}\b/g],
  ['AWS_ACCESS_KEY', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g],
  ['LIVE_SERVICE_KEY', /\bsk_live_[A-Za-z0-9]{24,}\b/g],
];
export function scanDiffSecrets(files) {
  const findings = [];
  for (const file of files) {
    const lines = (file.patch ?? '').split('\n');
    for (const [index, line] of lines.entries()) {
      if (!line.startsWith('+') || line.startsWith('+++')) continue;
      for (const [code, pattern] of patterns) {
        pattern.lastIndex = 0;
        for (const match of line.matchAll(pattern))
          findings.push({
            code,
            location: file.filename,
            patchLine: index + 1,
            fingerprint: digest(match[0]),
            reason:
              'Potential credential material detected in added content. Remove it, rotate any exposed credential, and rerun verification. The value is intentionally omitted.',
          });
      }
    }
  }
  return findings;
}
