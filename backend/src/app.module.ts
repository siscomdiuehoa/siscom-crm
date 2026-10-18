import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { CustomersModule } from './modules/customers/customers.module';
import { LookupsModule } from './modules/lookups/lookups.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }), PrismaModule, HealthModule, CustomersModule, LookupsModule],
})
export class AppModule {}
