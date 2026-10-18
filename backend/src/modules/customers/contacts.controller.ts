import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import type { RequestCtx } from '../../common/auth/actor';
import { CurrentCtx } from '../../common/auth/actor.decorator';
import { ActorGuard } from '../../common/auth/actor.guard';
import { ContactsService } from './customers.contacts.service';
import { CreateContactDto } from './dto/create-contact.dto';

@Controller('customers/:customerId/contacts')
@UseGuards(ActorGuard)
export class ContactsController {
  constructor(private readonly service: ContactsService) {}

  @Get()
  async list(@CurrentCtx() ctx: RequestCtx, @Param('customerId', new ParseUUIDPipe()) customerId: string) {
    return { data: await this.service.list(ctx, customerId) };
  }

  @Post()
  async create(@CurrentCtx() ctx: RequestCtx, @Param('customerId', new ParseUUIDPipe()) customerId: string, @Body() dto: CreateContactDto) {
    return { data: await this.service.create(ctx, customerId, dto) };
  }
}
