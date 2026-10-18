import { makeDecorator } from './make-decorator';

export const WEBSITE_MESSAGE = 'Website chưa đúng định dạng (VD: congty.vn)';
export const isWebsite = (s: string): boolean => /^(https?:\/\/)?([\w-]+\.)+[a-z]{2,}(\/\S*)?$/i.test(s.trim());
export const IsWebsite = makeDecorator('isWebsite', isWebsite, WEBSITE_MESSAGE);
