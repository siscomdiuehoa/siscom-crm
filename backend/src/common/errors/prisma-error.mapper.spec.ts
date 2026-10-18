import { mapPrismaError } from './prisma-error.mapper';

describe('mapPrismaError', () => {
  it('P2002 trên MST -> CUSTOMER_DUPLICATE_TAX_ID', () => {
    const m = mapPrismaError({ code: 'P2002', meta: { target: ['uq_customer_tax_id_active'] } });
    expect(m?.getStatus()).toBe(409);
    expect(m?.code).toBe('CUSTOMER_DUPLICATE_TAX_ID');
  });
  it('SQLSTATE 23505 trong meta.driverAdapterError, kèm tên constraint', () => {
    const m = mapPrismaError({ code: 'P2010', meta: { driverAdapterError: { cause: { originalCode: '23505', constraint: 'uq_customer_tax_id_active' } } } });
    expect(m?.code).toBe('CUSTOMER_DUPLICATE_TAX_ID');
  });
  it('unique khác -> CONSTRAINT_CONFLICT; liên hệ chính -> CONTACT_PRIMARY_CONFLICT', () => {
    expect(mapPrismaError({ code: 'P2002', meta: { target: ['customer_code_key'] } })?.code).toBe('CONSTRAINT_CONFLICT');
    expect(mapPrismaError({ code: 'P2002', meta: { target: ['uq_contact_primary_active'] } })?.code).toBe('CONTACT_PRIMARY_CONFLICT');
  });
  it('lock_timeout / serialization / deadlock -> CUSTOMER_BUSY', () => {
    for (const st of ['55P03', '40001', '40P01']) expect(mapPrismaError({ code: 'P2010', meta: { code: st } })?.code).toBe('CUSTOMER_BUSY');
  });
  it('FK / CHECK / restrict -> CONSTRAINT_CONFLICT', () => {
    expect(mapPrismaError({ code: 'P2003' })?.code).toBe('CONSTRAINT_CONFLICT');
    for (const st of ['23503', '23514', '23001']) expect(mapPrismaError({ code: 'P2010', meta: { code: st } })?.code).toBe('CONSTRAINT_CONFLICT');
  });
  it('P2025 -> 404', () => expect(mapPrismaError({ code: 'P2025' })?.getStatus()).toBe(404));
  it('lỗi không phải DB -> null (để thành 500 chung)', () => {
    expect(mapPrismaError(new Error('boom'))).toBeNull();
    expect(mapPrismaError({ code: 'ECONNREFUSED' })).toBeNull();
    expect(mapPrismaError(null)).toBeNull();
  });
  it('thông điệp không lộ tên constraint/cột', () => {
    const m = mapPrismaError({ code: 'P2002', message: 'Unique constraint failed on uq_customer_tax_id_active (tax_id)=(0312345678)', meta: { target: ['uq_customer_tax_id_active'] } });
    expect(JSON.stringify(m?.getResponse())).not.toMatch(/uq_|tax_id|0312345678/);
  });
});
