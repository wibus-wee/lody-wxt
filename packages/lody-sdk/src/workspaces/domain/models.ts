/** Better Auth organization rows, not the role-enriched Convex WorkspaceSummary. */
export interface Workspace {
  id: string;
  name: string;
  slug: string;
  logo?: string | null;
  createdAt?: string;
  metadata?: unknown;
  [field: string]: unknown;
}
