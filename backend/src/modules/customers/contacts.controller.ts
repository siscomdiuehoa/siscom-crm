import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import type { RequestCtx } from '../../common/auth/actor';
import { CurrentCtx } from '../../common/auth/actor.decorator';
import { ActorGuard } from '../../common/auth/actor.guard';
import { RequirePermissions } from '../../common/auth/permissions.decorator';
import { ContactsService } from './customers.contacts.service';
import { CreateContactDto } from './dto/create-contact.dto';

@Controller('customers/:customerId/contacts')
@UseGuards(ActorGuard)
export class ContactsController {
  constructor(private readonly service: ContactsService) {}

  @Get()
  @RequirePermissions('contact.read', 'customer.read')
  async list(@CurrentCtx() ctx: RequestCtx, @Param('customerId', new ParseUUIDPipe()) customerId: string) {
    return { data: await this.service.list(ctx, customerId) };
  }

  @Post()
  @RequirePermissions('contact.create', 'customer.update', 'customer.read')
  async create(@CurrentCtx() ctx: RequestCtx, @Param('customerId', new ParseUUIDPipe()) customerId: string, @Body() dto: CreateContactDto) {
    return { data: await this.service.create(ctx, customerId, dto) };
  }
}
