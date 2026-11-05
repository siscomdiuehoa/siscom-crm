import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { ActivitiesModule } from './modules/activities/activities.module';
import { AuthApiModule } from './modules/auth/auth-api.module';
import { CustomersModule } from './modules/customers/customers.module';
import { LookupsModule } from './modules/lookups/lookups.module';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true, cache: true, validate: validateEnv }), PrismaModule, HealthModule, AuthApiModule, CustomersModule, LookupsModule, ActivitiesModule],
})
export class AppModule {}
