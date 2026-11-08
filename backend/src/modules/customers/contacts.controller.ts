import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import type { RequestCtx } from '../../common/auth/actor';
import { CurrentCtx } from '../../common/auth/actor.decorator';
import { ActorGuard } from '../../common/auth/actor.guard';
import { ContactsService } from './customers.contacts.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { DeleteContactDto, UpdateContactDto } from './dto/update-contact.dto';

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

  // FV-3: sửa / xoá mềm — quyền customer.update trên khách chủ quản (kiểm trong service).
  @Patch(':contactId')
  async update(@CurrentCtx() ctx: RequestCtx, @Param('customerId', new ParseUUIDPipe()) customerId: string, @Param('contactId', new ParseUUIDPipe()) contactId: string, @Body() dto: UpdateContactDto) {
    return { data: await this.service.update(ctx, customerId, contactId, dto) };
  }

  @Delete(':contactId')
  async remove(@CurrentCtx() ctx: RequestCtx, @Param('customerId', new ParseUUIDPipe()) customerId: string, @Param('contactId', new ParseUUIDPipe()) contactId: string, @Body() dto: DeleteContactDto) {
    return { data: await this.service.remove(ctx, customerId, contactId, dto) };
  }
}
