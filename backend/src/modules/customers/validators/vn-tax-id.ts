import { makeDecorator } from './make-decorator';

export const TAX_MESSAGE = 'MST gồm 10 chữ số, hoặc 13 chữ số dạng 0123456789-001';
export const isTaxId = (s: string): boolean => /^\d{10}(-\d{3})?$/.test(s.trim());
export const IsTaxId = makeDecorator('isTaxId', isTaxId, TAX_MESSAGE);
