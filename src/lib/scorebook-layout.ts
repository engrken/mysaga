/**
 * Responsive ECR column pagination. Every assessment remains reachable without
 * shrinking workbook cells to unreadable widths. Totals always use the entire
 * gradebook, irrespective of the current assessment view.
 */
export type WorkbookCategory = { id: string; label: string; assessmentIds: string[]; parentId?: string };
export type WorkbookSegment = {
  categoryId: string;
  categoryLabel: string;
  parentId?: string;
  assessmentIds: string[];
  part: number;
  totalParts: number;
};
export type WorkbookPage = { segments: WorkbookSegment[]; label: string; assessmentCount: number };

export function workbookWidths(containerWidth: number) {
  const width = Number.isFinite(containerWidth) ? Math.max(760, containerWidth) : 1200;
  return {
    student: Math.round(Math.max(160, Math.min(250, width * .19))),
    attendance: Math.round(Math.max(78, Math.min(108, width * .072))),
    total: Math.round(Math.max(92, Math.min(122, width * .075))),
    final: Math.round(Math.max(76, Math.min(104, width * .064))),
    remark: Math.round(Math.max(104, Math.min(144, width * .086))),
    assessment: 78,
    equivalent: 73
  };
}
export function workbookColumnBudget(width: number) {
  const w = workbookWidths(width);
  return Math.max(180, Math.floor(width - w.student - w.attendance - w.total - w.final - w.remark - 10));
}
export function estimateWorkbookSegmentWidth(count: number, width: number) {
  const w = workbookWidths(width);
  return count * w.assessment + w.equivalent;
}
export function buildWorkbookPages(categories: WorkbookCategory[], width: number): WorkbookPage[] {
  const limit = workbookColumnBudget(width);
  const widths = workbookWidths(width);
  const hasDomainSummaries = categories.some(category => !!category.parentId);
  const maxItems = Math.max(1, Math.floor((limit - widths.equivalent * (hasDomainSummaries ? 3 : 1)) / widths.assessment));
  const chunks: WorkbookSegment[] = [];
  for (const category of categories) {
    if (!category.assessmentIds.length) continue;
    const count = Math.ceil(category.assessmentIds.length / maxItems);
    for (let i = 0; i < count; i++) {
      chunks.push({
        categoryId: category.id,
        categoryLabel: category.label,
        parentId: category.parentId,
        assessmentIds: category.assessmentIds.slice(i * maxItems, (i + 1) * maxItems),
        part: i + 1,
        totalParts: count
      });
    }
  }
  const pages: WorkbookPage[] = [];
  let grouped: WorkbookSegment[] = [];
  let used = 0;
  const pageRoots = new Set<string>();
  const flush = () => {
    if (!grouped.length) return;
    const titles = grouped.map(segment => segment.totalParts > 1
      ? `${segment.categoryLabel} (${segment.part}/${segment.totalParts})`
      : segment.categoryLabel);
    pages.push({
      segments: grouped,
      label: titles.length === 1 ? titles[0] : `${titles[0]} + ${titles.length - 1} more`,
      assessmentCount: grouped.reduce((sum, segment) => sum + segment.assessmentIds.length, 0)
    });
    grouped = []; used = 0; pageRoots.clear();
  };
  for (const segment of chunks) {
    const segmentWidth = estimateWorkbookSegmentWidth(segment.assessmentIds.length, width);
    const domainWidth = segment.parentId && !pageRoots.has(segment.parentId) ? widths.equivalent * 2 : 0;
    if (grouped.length && used + segmentWidth + domainWidth > limit) flush();
    const pageDomainWidth = segment.parentId && !pageRoots.has(segment.parentId) ? widths.equivalent * 2 : 0;
    grouped.push(segment);
    used += segmentWidth + pageDomainWidth;
    if (segment.parentId) pageRoots.add(segment.parentId);
  }
  flush();
  return pages;
}


export type ScorebookHeaderColumnKind = "assessment" | "equivalent" | "domain-total" | "domain-weighted";
export type ScorebookHeaderCell =
  | { kind: "category"; categoryId: string; colSpan: number; rowSpan: number }
  | { kind: "domain-total" | "domain-weighted"; categoryId: string; colSpan: 1; rowSpan: number }
  | { kind: "spacer"; categoryId: string; colSpan: number; rowSpan: number };
export type ScorebookHeaderLayout = {
  rows: ScorebookHeaderCell[][];
  rowSpan: number;
  bottomColumnIndexes: number[];
  columnCount: number;
  maxDepth: number;
};

/**
 * Builds a header matrix from the same ordered leaf columns rendered by the
 * Record Scores table. Root spans include their two domain summary columns.
 */
export function buildScorebookHeaderLayout(
  categories: Array<{ id: string; parentId: string | null; sortOrder: number }>,
  rootCategoryIds: string[],
  columns: Array<{ categoryId: string; kind: ScorebookHeaderColumnKind }>
): ScorebookHeaderLayout {
  if (!columns.length || !rootCategoryIds.length) {
    return { rows: [], rowSpan: 1, bottomColumnIndexes: [], columnCount: columns.length, maxDepth: 0 };
  }

  const byId = new Map(categories.map(category => [category.id, category]));
  const childrenByParent = new Map<string, typeof categories>();
  for (const category of categories) {
    if (!category.parentId) continue;
    const children = childrenByParent.get(category.parentId) ?? [];
    children.push(category);
    childrenByParent.set(category.parentId, children);
  }
  for (const children of childrenByParent.values()) {
    children.sort((left, right) => left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
  }

  const descendantsCache = new Map<string, Set<string>>();
  const descendantsOf = (id: string, ancestors = new Set<string>()): Set<string> => {
    const cached = descendantsCache.get(id);
    if (cached) return cached;
    if (ancestors.has(id)) return new Set([id]);
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(id);
    const descendants = new Set([id]);
    for (const child of childrenByParent.get(id) ?? []) {
      for (const childId of descendantsOf(child.id, nextAncestors)) descendants.add(childId);
    }
    descendantsCache.set(id, descendants);
    return descendants;
  };

  const summaryKinds = new Set<ScorebookHeaderColumnKind>(["domain-total", "domain-weighted"]);
  const spanFor = (id: string) => {
    const descendants = descendantsOf(id);
    return columns.reduce((count, column) => count + (descendants.has(column.categoryId) ? 1 : 0), 0);
  };
  const categoryDepth = (id: string) => {
    let depth = 0;
    let current = byId.get(id);
    const visited = new Set([id]);
    while (current?.parentId && byId.has(current.parentId) && !visited.has(current.parentId)) {
      visited.add(current.parentId);
      current = byId.get(current.parentId);
      depth += 1;
    }
    return depth;
  };

  const detailColumns = columns.filter(column => !summaryKinds.has(column.kind));
  const maxDepth = Math.max(0, ...detailColumns.map(column => categoryDepth(column.categoryId)));
  const rows: ScorebookHeaderCell[][] = Array.from({ length: maxDepth + 1 }, () => []);

  const appendCategory = (id: string, depth: number) => {
    const colSpan = spanFor(id);
    if (!colSpan) return;
    const children = (childrenByParent.get(id) ?? []).filter(child => spanFor(child.id) > 0);
    rows[depth].push({
      kind: "category",
      categoryId: id,
      colSpan,
      rowSpan: depth === 0 ? 1 : children.length ? 1 : Math.max(1, maxDepth - depth + 1)
    });
    children.forEach(child => appendCategory(child.id, depth + 1));
  };

  for (const rootId of rootCategoryIds) {
    if (!byId.has(rootId) || !spanFor(rootId)) continue;
    const children = (childrenByParent.get(rootId) ?? []).filter(child => spanFor(child.id) > 0);
    appendCategory(rootId, 0);

    if (maxDepth > 0) {
      const rootDescendants = descendantsOf(rootId);
      const innerColumnCount = columns.reduce((count, column) =>
        count + (rootDescendants.has(column.categoryId) && !summaryKinds.has(column.kind) ? 1 : 0), 0);

      // A domain containing directly assigned assessments has no child header
      // to occupy this tier. A neutral spacer keeps later cells in the right
      // columns when another domain has a deeper category tree.
      if (!children.length && innerColumnCount > 0) {
        rows[1].push({ kind: "spacer", categoryId: rootId, colSpan: innerColumnCount, rowSpan: maxDepth });
      }
      if (columns.some(column => column.categoryId === rootId && column.kind === "domain-total")) {
        rows[1].push({ kind: "domain-total", categoryId: rootId, colSpan: 1, rowSpan: maxDepth + 1 });
      }
      if (columns.some(column => column.categoryId === rootId && column.kind === "domain-weighted")) {
        rows[1].push({ kind: "domain-weighted", categoryId: rootId, colSpan: 1, rowSpan: maxDepth + 1 });
      }
    }
  }

  return {
    rows,
    rowSpan: maxDepth + 2,
    bottomColumnIndexes: columns
      .map((column, index) => ({ column, index }))
      .filter(({ column }) => maxDepth === 0 || !summaryKinds.has(column.kind))
      .map(({ index }) => index),
    columnCount: columns.length,
    maxDepth
  };
}
