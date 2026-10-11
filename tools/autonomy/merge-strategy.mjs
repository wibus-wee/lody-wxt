// The caller supplies effective active branch rules. Missing rule metadata fails closed.
export function mergeStrategyFindings(strategy, rules) {
  if (!['protected-auto-merge', 'merge-queue'].includes(strategy))
    return ['UNKNOWN_MERGE_STRATEGY'];
  if (!Array.isArray(rules)) return ['MERGE_RULES_UNVERIFIED'];
  const queues = rules.filter((rule) => rule.type === 'merge_queue');
  if (strategy === 'protected-auto-merge')
    return queues.length === 0 ? [] : ['UNEXPECTED_MERGE_QUEUE'];
  return queues.length > 0 &&
    queues.every(
      (rule) =>
        rule.parameters?.max_entries_to_build === 1 && rule.parameters?.max_entries_to_merge === 1,
    )
    ? []
    : ['MERGE_QUEUE_REQUIRED'];
}
