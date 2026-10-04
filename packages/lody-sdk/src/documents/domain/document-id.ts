const documentIdPattern = /^[\w:-]{1,128}$/;

// The domain ID contract must remain dependency-free and reject non-string callers.
// ast-grep-ignore: no-unknown-parameter, no-manual-type-guard
export function validDocumentId(value: unknown): value is string {
  // Primitive narrowing keeps regex coercion from admitting non-string identifiers.
  // ast-grep-ignore: no-typeof-operator
  return typeof value === 'string' && documentIdPattern.test(value);
}
