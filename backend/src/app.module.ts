import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './common/auth/auth.module';
import { PrivilegedModule } from './common/auth/privileged/privileged.module';
import { validateEnv } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { CustomersModule } from './modules/customers/customers.module';
import { LookupsModule } from './modules/lookups/lookups.module';
import { PrismaModule } from './prisma/prisma.module';

// AuthModule nap TRUC TIEP (khong chi qua module nghiep vu) de AccessGuard toan cuc luon co mat (B1.3 M1.3).
@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }), PrismaModule, AuthModule, PrivilegedModule, HealthModule, CustomersModule, LookupsModule],
})
export class AppModule {}
