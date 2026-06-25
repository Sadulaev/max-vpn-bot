import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';
import { SiteAuthService } from './site-auth.service';

class RegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;
}

class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  password!: string;
}

@ApiTags('Site Auth')
@Controller('santa-chat/auth')
export class SiteAuthController {
  constructor(private readonly siteAuthService: SiteAuthService) {}

  @Post('register')
  @ApiOperation({ summary: 'Register a new site user' })
  register(@Body() dto: RegisterDto) {
    return this.siteAuthService.register(dto.email, dto.password);
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login as a site user' })
  login(@Body() dto: LoginDto) {
    return this.siteAuthService.login(dto.email, dto.password);
  }

  @Get('me')
  @UseGuards(AuthGuard('site-jwt'))
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current site user' })
  getMe(@Request() req: { user: { sub: string } }) {
    return this.siteAuthService.getMe(req.user.sub);
  }
}
