const skillTokenPattern = /^\S+$/u;
const skillFileSuffix = /\/SKILL\.md$/iu;
const spaces = /\s+/gu;
const backslashes = /\\/gu;
const closingParentheses = /\)/gu;

export function skillMentionToken(skill: { name: string; relativePath: string }) {
  const name = skill.name.trim();
  if (name && skillTokenPattern.test(name)) return name;
  const directory = skill.relativePath.replace(skillFileSuffix, '');
  return (directory.split('/').filter(Boolean).at(-1) ?? name).replace(spaces, '-');
}

export function formatSkillMentionPrompt(token: string, path: string) {
  const destination = path.replace(backslashes, '\\\\').replace(closingParentheses, '\\)');
  return `use /${token} [Skill Path](${destination})`;
}
