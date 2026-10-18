import { Module } from '@nestjs/common';
import { AuthModule } from '../../common/auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { LookupsController } from './lookups.controller';
import { LookupsService } from './lookups.service';

@Module({ imports: [AuthModule, PrismaModule], controllers: [LookupsController], providers: [LookupsService] })
export class LookupsModule {}
