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

// B3 A6: dòng hoạt động kèm thông tin khách tối thiểu cho kiểm quyền (chủ, phòng chủ, đã xoá) + trường xoá mềm.
export const ACTIVITY_TASK_SELECT = {
  ...ACTIVITY_SELECT, deletedAt: true,
  customer: { select: { id: true, code: true, name: true, deletedAt: true, ownerId: true, owner: { select: { departmentId: true } } } },
} as const;
export interface ActivityTaskRow extends ActivityRow {
  deletedAt: Date | null;
  customer: { id: string; code: string; name: string; deletedAt: Date | null; ownerId: string | null; owner: { departmentId: string | null } | null };
}

export function toTransfer(r: {
  id: string; status: string; reason: string; decisionNote: string | null; createdAt: Date; decidedAt: Date | null;
  activity: { id: string; code: string; type: string; status: string };
  fromEmployee: Ref; toEmployee: Ref;
}) {
  return {
    id: r.id, status: r.status, reason: r.reason, decisionNote: r.decisionNote, createdAt: r.createdAt.toISOString(), decidedAt: iso(r.decidedAt),
    activity: { id: r.activity.id, code: r.activity.code, type: r.activity.type, status: r.activity.status },
    from: { id: r.fromEmployee.id, code: r.fromEmployee.code, fullName: r.fromEmployee.fullName },
    to: { id: r.toEmployee.id, code: r.toEmployee.code, fullName: r.toEmployee.fullName },
  };
}
export const TRANSFER_SELECT = {
  id: true, status: true, reason: true, decisionNote: true, createdAt: true, decidedAt: true, activityId: true, fromEmployeeId: true, toEmployeeId: true,
  activity: { select: { id: true, code: true, type: true, status: true } },
  fromEmployee: { select: { id: true, code: true, fullName: true } },
  toEmployee: { select: { id: true, code: true, fullName: true } },
} as const;

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
