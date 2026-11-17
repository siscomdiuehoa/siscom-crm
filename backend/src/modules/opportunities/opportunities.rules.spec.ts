import { OPPORTUNITY_STAGE as S, OPPORTUNITY_TYPE as T } from '../lookups/sales.catalog';
import { defaultProbability, isConstructionType, ruleViolations, RuleState } from './opportunities.rules';

// Sales S7 — luật R-S1..R-S3 (docs/SALES_DESIGN.md §4.1), kiểm trên trạng thái SAU khi cập nhật. Hàm thuần, không DB.
const base: RuleState = { status: 'OPEN', stageCode: S.PROSPECTING, typeCode: T.SUPPLY, needSummary: null, expectedAmountVnd: null, isProjectLinked: false, projectName: null, offerScope: null };
const fields = (s: Partial<RuleState>) => ruleViolations({ ...base, ...s }).map((e) => e.field).sort();

describe('R-S1 — từ Báo giá trở đi và đang mở thì phải có giá trị', () => {
  it('Tiếp cận / Khảo sát: không bắt giá trị', () => {
    expect(fields({})).toEqual([]);
    expect(fields({ stageCode: S.SURVEY, needSummary: 'x' })).toEqual([]);
  });
  it('Báo giá / Đàm phán + OPEN + chưa có giá trị => lỗi expectedAmountVnd; có giá trị (kể cả 0) => qua', () => {
    for (const stageCode of [S.QUOTATION, S.NEGOTIATION]) {
      expect(fields({ stageCode, needSummary: 'x' })).toEqual(['expectedAmountVnd']);
      expect(fields({ stageCode, needSummary: 'x', expectedAmountVnd: 0n })).toEqual([]);
      expect(fields({ stageCode, needSummary: 'x', expectedAmountVnd: 7_200_000_000n })).toEqual([]);
    }
  });
  it('không áp khi ON_HOLD / WON / LOST', () => {
    for (const status of ['ON_HOLD', 'WON', 'LOST']) expect(fields({ status, stageCode: S.QUOTATION, needSummary: 'x' })).toEqual([]);
  });
});

describe('R-S2 — rời Tiếp cận thì phải có nhu cầu của khách', () => {
  it('khác Tiếp cận mà nhu cầu trống / chỉ khoảng trắng => lỗi needSummary (ở mọi trạng thái)', () => {
    for (const stageCode of [S.SURVEY, S.QUOTATION, S.NEGOTIATION]) {
      expect(fields({ stageCode, expectedAmountVnd: 1n })).toEqual(['needSummary']);
      expect(fields({ stageCode, expectedAmountVnd: 1n, needSummary: '   ' })).toEqual(['needSummary']);
      expect(fields({ stageCode, expectedAmountVnd: 1n, needSummary: 'x', status: 'ON_HOLD' })).toEqual([]);
    }
    expect(fields({ stageCode: S.SURVEY, status: 'ON_HOLD' })).toEqual(['needSummary']);
  });
});

describe('R-S3 và trường dự án', () => {
  it('Thi công / Cung cấp và thi công: phải gắn dự án, kèm tên dự án + phạm vi chào', () => {
    for (const typeCode of [T.INSTALLATION, T.SUPPLY_INSTALLATION]) {
      expect(isConstructionType(typeCode)).toBe(true);
      expect(fields({ typeCode })).toEqual(['isProjectLinked']);
      expect(fields({ typeCode, isProjectLinked: true })).toEqual(['offerScope', 'projectName']);
      expect(fields({ typeCode, isProjectLinked: true, projectName: 'Tháp A', offerScope: '  ' })).toEqual(['offerScope']);
      expect(fields({ typeCode, isProjectLinked: true, projectName: 'Tháp A', offerScope: 'Lắp đặt' })).toEqual([]);
    }
  });
  it('Cung cấp thiết bị: gắn dự án là tuỳ chọn; đã gắn thì vẫn bắt tên + phạm vi; không gắn thì không được kèm hai trường đó', () => {
    expect(isConstructionType(T.SUPPLY)).toBe(false);
    expect(fields({ typeCode: T.SUPPLY })).toEqual([]);
    expect(fields({ typeCode: T.SUPPLY, isProjectLinked: true })).toEqual(['offerScope', 'projectName']);
    expect(fields({ typeCode: T.SUPPLY, isProjectLinked: true, projectName: 'Khách sạn B', offerScope: 'Cung cấp 120 FCU' })).toEqual([]);
    expect(fields({ typeCode: T.SUPPLY, projectName: 'Khách sạn B' })).toEqual(['projectName']);
    expect(fields({ typeCode: T.SUPPLY, offerScope: 'x' })).toEqual(['offerScope']);
  });
});

describe('luật chỉ theo MÃ', () => {
  it('mã giai đoạn lạ: không phải Tiếp cận => vẫn bắt nhu cầu; không thuộc nhóm bắt giá trị', () => {
    expect(fields({ stageCode: 'T_QUOTE' })).toEqual(['needSummary']);
    expect(fields({ stageCode: 'T_QUOTE', needSummary: 'x' })).toEqual([]);
  });
  it('xác suất mặc định: 10 / 25 / 45 / 70; giai đoạn lạ => undefined (service phải từ chối)', () => {
    expect([S.PROSPECTING, S.SURVEY, S.QUOTATION, S.NEGOTIATION].map(defaultProbability)).toEqual([10, 25, 45, 70]);
    expect(defaultProbability('T_QUOTE')).toBeUndefined();
  });
  it('nhiều lỗi cùng lúc được báo đủ theo trường', () => {
    expect(fields({ stageCode: S.NEGOTIATION, typeCode: T.INSTALLATION })).toEqual(['expectedAmountVnd', 'isProjectLinked', 'needSummary']);
  });
});
