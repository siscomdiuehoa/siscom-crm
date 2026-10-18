import { registerDecorator, ValidationOptions } from 'class-validator';

// Tạo decorator class-validator từ một hàm kiểm tra chuỗi (bản TS của quy tắc frontend B1.1).
export function makeDecorator(name: string, test: (v: string) => boolean, message: string) {
  return (options?: ValidationOptions) => (object: object, propertyName: string): void => {
    registerDecorator({
      name,
      target: object.constructor,
      propertyName,
      options: { message, ...options },
      validator: { validate: (value: unknown) => typeof value === 'string' && test(value) },
    });
  };
}
