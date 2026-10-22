import type { Request } from 'express';
import type { Actor } from '../actor';
import { EVIDENCE_SQL } from './readiness.evidence';

// Bằng chứng DB lấy từ MỘT pool cụ thể. Không có triển khai mặc định trong DI: thiếu probe => KHÔNG sẵn sàng.
export interface DbEvidenceProbe {
  // Trả đúng một hàng bằng chứng (xem EVIDENCE_SQL). Ném lỗi/hết giờ => coi là không sẵn sàng.
  fetchEvidence(): Promise<unknown>;
}
export const GENERAL_DB_PROBE = Symbol('GENERAL_DB_PROBE');
export const AUTH_DB_PROBE = Symbol('AUTH_DB_PROBE');

// Bộ chạy SQL tối thiểu do pool tương ứng cung cấp (chỉ nhận chuỗi SQL cố định EVIDENCE_SQL).
export type SqlRunner = (sql: string) => Promise<unknown[]>;

// Probe chỉ chạy ĐÚNG câu EVIDENCE_SQL cố định (không nhận SQL từ bên ngoài, không tham số).
export class PgCatalogProbe implements DbEvidenceProbe {
  constructor(private readonly run: SqlRunner) {}
  async fetchEvidence(): Promise<unknown> {
    const rows = await this.run(EVIDENCE_SQL);
    if (!Array.isArray(rows) || rows.length !== 1) throw new Error('evidence: cần đúng 1 hàng');
    return rows[0];
  }
}

export interface BoundActor extends Actor {
  // Bằng chứng ràng buộc danh tính mà DB kiểm được (xem docs/B1.3_F01_PHASE2_ARCHITECTURE.md). Chuỗi mờ; không log.
  readonly proof: string;
}

// Xác thực danh tính cho thao tác đặc quyền. Danh tính chỉ được rút ra từ phiên/chứng cứ đã xác thực của request,
// KHÔNG BAO GIỜ từ body/query/header do người gọi khai (x-actor-id, actorId, p_actor ...).
export interface ActorBindingVerifier {
  // Phải là true CHỈ KHI bằng chứng `proof` được chính PostgreSQL đối chiếu lại bên trong hàm API (giai đoạn 2).
  // Triển khai xác minh ở tầng Node rồi chuyển p_actor trần KHÔNG được khai true (đó chính là F-01).
  readonly dbVerifiable: boolean;
  verify(req: Request): Promise<BoundActor | null>;
}
export const ACTOR_BINDING_VERIFIER = Symbol('ACTOR_BINDING_VERIFIER');

export type AuthedPrivRequest = Request & { actor?: Actor; privilegedActor?: BoundActor };
