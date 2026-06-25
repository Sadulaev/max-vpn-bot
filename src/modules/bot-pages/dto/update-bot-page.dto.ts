import { PartialType } from '@nestjs/mapped-types';
import { CreateBotPageDto } from './create-bot-page.dto';

export class UpdateBotPageDto extends PartialType(CreateBotPageDto) {}
