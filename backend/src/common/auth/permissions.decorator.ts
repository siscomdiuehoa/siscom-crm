import { SetMetadata } from '@nestjs/common';
import type { Permission } from './actor';

// B1.3 M1.3 — chính sách TỪNG endpoint (fail-closed). Route không khai báo @RequirePermissions(...) hoặc @Public() => AccessGuard trả 403.
// Quyền ở đây chỉ là CỔNG VÀO (có quyền với phạm vi bất kỳ); phạm vi ALL/DEPARTMENT/OWN trên từng bản ghi vẫn do service kiểm (inScope).
export const PERMISSIONS_KEY = 'siscom:permissions';
export const PUBLIC_KEY = 'siscom:public';

// Cần ĐỦ mọi quyền liệt kê (AND). Danh sách rỗng bị coi là chưa khai báo (từ chối).
export const RequirePermissions = (...permissions: [Permission, ...Permission[]]) => SetMetadata(PERMISSIONS_KEY, permissions);

// Chỉ dùng cho endpoint không cần danh tính (health). Không dùng chung với RequirePermissions.
export const Public = () => SetMetadata(PUBLIC_KEY, true);
