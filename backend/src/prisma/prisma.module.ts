import { Global, Module } from '@nestjs/common';
import { AuthPrismaService } from './auth-prisma.service';
import { PrismaService } from './prisma.service';

@Global()
// B1.4 P3c: hai pool - PrismaService (siscom_app, nghiep vu) va AuthPrismaService (siscom_auth, xac thuc).
@Module({ providers: [PrismaService, AuthPrismaService], exports: [PrismaService, AuthPrismaService] })
export class PrismaModule {}
