// Trường trả về của hoạt động. Người đọc được hoạt động (activity.read trong phạm vi khách) xem được nội dung; nhật ký (audit) thì KHÔNG.
export const ACTIVITY_SELECT = {
  id: true, code: true, customerId: true, contactId: true, type: true, title: true, content: true, outcome: true,
  occurredAt: true, dueAt: true, remindAt: true, status: true, completedAt: true, completedById: true, performedById: true,
  version: true, createdAt: true, updatedAt: true, createdById: true,
  performedBy: { select: { id: true, code: true, fullName: true } },
  contact: { select: { id: true, code: true, fullName: true } },
} as const;

interface Ref { id: string; code: string; fullName: string }
export interface ActivityRow {
  id: string; code: string; customerId: string; contactId: string | null; type: string; title: string | null; content: string; outcome: string | null;
  occurredAt: Date; dueAt: Date | null; remindAt: Date | null; status: string; completedAt: Date | null; completedById: string | null; performedById: string | null;
  version: number; createdAt: Date; updatedAt: Date; createdById: string | null;
  performedBy: Ref | null; contact: Ref | null;
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

export function toActivity(r: ActivityRow) {
  return {
    id: r.id, code: r.code, customerId: r.customerId, type: r.type, title: r.title, content: r.content, outcome: r.outcome,
    occurredAt: r.occurredAt.toISOString(), dueAt: iso(r.dueAt), remindAt: iso(r.remindAt),
    status: r.status, completedAt: iso(r.completedAt), completedById: r.completedById,
    performedBy: r.performedBy ? { id: r.performedBy.id, code: r.performedBy.code, fullName: r.performedBy.fullName } : null,
    contact: r.contact ? { id: r.contact.id, code: r.contact.code, fullName: r.contact.fullName } : null,
    createdById: r.createdById, version: r.version, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  };
}
