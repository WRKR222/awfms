import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AdminResetPasswordDto {
  @ApiProperty({ example: 'NewTemp@2025!' })
  @IsString()
  @MinLength(8)
  newPassword: string;
}
