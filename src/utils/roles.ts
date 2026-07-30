import type { Page } from '../app/components/AppShell';
import { canAccessModule, PAGE_MODULE_MAP, type PermissionModule } from './permissions';

export type { UserRole } from './permissions';

export function canAccessPage(role: string | undefined, page: Page): boolean {
  const module = PAGE_MODULE_MAP[page] as PermissionModule | undefined;
  if (!module) return true;
  return canAccessModule(role, module);
}

export function filterNavSections<T extends { items: { id: Page }[] }>(
  sections: T[],
  role: string | undefined
): T[] {
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => canAccessPage(role, item.id)),
    }))
    .filter((section) => section.items.length > 0);
}
