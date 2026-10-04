import { LodySdkError } from '../../shared/domain/errors.js';

const workspaceIdPattern = /^[\w-]{1,128}$/;

export function workspaceId(value: string): string {
  // JavaScript callers may violate the signature; reject them without a domain library dependency.
  // ast-grep-ignore: no-typeof-operator
  const id = typeof value === 'string' ? value.trim() : '';
  if (!workspaceIdPattern.test(id)) throw new LodySdkError('invalid_argument');
  return id;
}
