import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ACTOR_PROVIDER, ActorProvider } from '../actor';
import { DenyAllActorProvider } from '../deny-all-actor.provider';
import { evaluateEvidence, evaluatePoolSeparation, ReadinessResult } from './readiness.evidence';
import { ACTOR_BINDING_VERIFIER, ActorBindingVerifier, AUTH_DB_PROBE, DbEvidenceProbe, GENERAL_DB_PROBE } from './privileged.types';

export const PRIVILEGED_CACHE_MS = 5000;
const PROBE_TIMEOUT_MS = 2000;

// Cổng fail-closed cho thao tác đặc quyền (RBAC/credential). SẴN SÀNG chỉ khi TẤT CẢ cùng đúng:
//  1. PRIVILEGED_AUTH_ENABLED=true (mặc định false; cờ này chỉ là "yêu cầu bật", KHÔNG chứng nhận gì);
//  2. ActorProvider không phải DenyAll;
//  3. có ActorBindingVerifier khai dbVerifiable=true;
//  4. bằng chứng PostgreSQL của pool GENERAL và pool AUTH đều đạt, và hai pool là hai danh tính DB khác nhau.
// Hiện (2)(3)(4) chưa có triển khai => cổng luôn đóng. Mọi lỗi/ngoại lệ/hết giờ => đóng.
@Injectable()
export class PrivilegedReadinessService implements OnModuleInit {
  private readonly log = new Logger('PrivilegedReadiness');
  private cached?: { at: number; result: ReadinessResult };

  constructor(
    private readonly config: ConfigService,
    @Inject(ACTOR_PROVIDER) private readonly provider: ActorProvider,
    @Optional() @Inject(ACTOR_BINDING_VERIFIER) private readonly verifier?: ActorBindingVerifier,
    @Optional() @Inject(GENERAL_DB_PROBE) private readonly general?: DbEvidenceProbe,
    @Optional() @Inject(AUTH_DB_PROBE) private readonly auth?: DbEvidenceProbe,
  ) {}

  // Chỉ đúng boolean true từ cấu hình đã kiểm (env.validation) mới là "yêu cầu bật".
  enabled(): boolean {
    return this.config.get('PRIVILEGED_AUTH_ENABLED') === true;
  }

  // Khởi động: nếu ai đó bật cờ mà hệ thống chưa chứng minh được an toàn => TỪ CHỐI KHỞI ĐỘNG (không âm thầm chạy).
  async onModuleInit(): Promise<void> {
    if (!this.enabled()) {
      this.log.log('API đặc quyền TẮT (PRIVILEGED_AUTH_ENABLED chưa bật).');
      return;
    }
    const r = await this.evaluate();
    if (!r.ready) {
      this.log.error('PRIVILEGED_AUTH_ENABLED=true nhưng chưa sẵn sàng: ' + r.reasons.join(','));
      throw new Error('PRIVILEGED_AUTH_ENABLED=true nhưng điều kiện an toàn chưa đạt: ' + r.reasons.join(','));
    }
  }

  async isReady(): Promise<boolean> {
    return (await this.evaluate()).ready;
  }

  async evaluate(): Promise<ReadinessResult> {
    const t = Date.now();
    if (this.cached && t - this.cached.at >= 0 && t - this.cached.at < PRIVILEGED_CACHE_MS) return this.cached.result;
    let result: ReadinessResult;
    try {
      result = await this.compute();
    } catch (e) {
      this.log.error('Kiểm tra sẵn sàng thất bại: ' + (e instanceof Error ? e.message : 'không rõ'));
      result = { ready: false, reasons: ['CHECK_ERROR'] };
    }
    this.cached = { at: t, result };
    return result;
  }

  private async compute(): Promise<ReadinessResult> {
    const reasons: string[] = [];
    if (!this.enabled()) reasons.push('FLAG_OFF');
    if (!this.provider || this.provider instanceof DenyAllActorProvider) reasons.push('ACTOR_PROVIDER_DENY_ALL');
    if (!this.verifier) reasons.push('NO_ACTOR_BINDING_VERIFIER');
    else if (this.verifier.dbVerifiable !== true) reasons.push('ACTOR_BINDING_NOT_DB_VERIFIABLE');
    if (!this.general) reasons.push('NO_GENERAL_PROBE');
    if (!this.auth) reasons.push('NO_AUTH_PROBE');
    if (reasons.length) return { ready: false, reasons };

    const [g, a] = await Promise.all([this.fetch(this.general as DbEvidenceProbe), this.fetch(this.auth as DbEvidenceProbe)]);
    const out = [...evaluateEvidence('GENERAL', g).reasons, ...evaluateEvidence('AUTH', a).reasons, ...evaluatePoolSeparation(g, a).reasons];
    return { ready: out.length === 0, reasons: out };
  }

  private fetch(p: DbEvidenceProbe): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('probe timeout')), PROBE_TIMEOUT_MS);
      p.fetchEvidence().then((v) => { clearTimeout(timer); resolve(v); }, (e: unknown) => { clearTimeout(timer); reject(e); });
    });
  }
}
