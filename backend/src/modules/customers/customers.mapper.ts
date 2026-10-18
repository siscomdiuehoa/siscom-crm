interface LookupRow { code: string; labelVi: string; isActive: boolean }
interface OwnerRow { id: string; code: string; fullName: string; departmentId: string | null }

// Cấu trúc tối thiểu mà mapper cần (kết quả Prisma với include bên dưới gán được vào đây).
export interface CustomerRow {
  id: string; code: string; name: string; shortName: string | null; taxId: string | null;
  address: string | null; phone: string; phoneE164: string | null; email: string | null; website: string | null;
  note: string | null; tags: string[]; revenueVnd: bigint; revenueBasis: string; version: number;
  createdAt: Date; updatedAt: Date; deletedAt: Date | null; restoredAt: Date | null; ownerId: string | null;
  tier: LookupRow; status: LookupRow; industry: LookupRow | null; source: LookupRow | null; province: LookupRow | null;
  owner: OwnerRow | null;
}

const lk = (l: LookupRow | null, detail: boolean) => (l ? (detail ? { code: l.code, label: l.labelVi, isActive: l.isActive } : { code: l.code, label: l.labelVi }) : null);
const owner = (o: OwnerRow | null) => (o ? { id: o.id, code: o.code, fullName: o.fullName } : null);

export function toDetail(r: CustomerRow) {
  return {
    id: r.id, code: r.code, name: r.name, shortName: r.shortName, taxId: r.taxId,
    tier: lk(r.tier, true), status: lk(r.status, true), industry: lk(r.industry, true), source: lk(r.source, true), province: lk(r.province, true),
    address: r.address, phone: r.phone, phoneE164: r.phoneE164, email: r.email, website: r.website,
    owner: owner(r.owner), note: r.note, tags: r.tags,
    revenueVnd: r.revenueVnd.toString(), revenueBasis: r.revenueBasis, // BigInt -> chuỗi (JSON không có BigInt)
    version: r.version, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
    deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null, restoredAt: r.restoredAt ? r.restoredAt.toISOString() : null,
  };
}

export function toListItem(r: CustomerRow) {
  return {
    id: r.id, code: r.code, name: r.name, shortName: r.shortName, taxId: r.taxId,
    tier: lk(r.tier, false), status: lk(r.status, false), industry: lk(r.industry, false), province: lk(r.province, false),
    phone: r.phone, email: r.email, owner: owner(r.owner), version: r.version,
    createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(), deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
  };
}
