import { makeDecorator } from './make-decorator';

export const EMAIL_MESSAGE = 'Email chưa đúng định dạng';
export const isEmailB1 = (s: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
export const IsEmailB1 = makeDecorator('isEmailB1', isEmailB1, EMAIL_MESSAGE);
