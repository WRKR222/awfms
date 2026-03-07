import { IsString, IsEmail, IsEnum, IsOptional, IsArray, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { UserRole } from '@prisma/client';

export class CreateUserDto {
  @ApiProperty({ example: 'james.muriithi' })
  @IsString()
  @MinLength(3)
  username: string;

  @ApiProperty({ example: 'james@anzawf.co.ke' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'James Muriithi' })
  @IsString()
  fullName: string;

  @ApiProperty({ enum: UserRole })
  @IsEnum(UserRole)
  role: UserRole;

  @ApiProperty({ example: 'TempPass123!' })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty({ example: ['house-uuid-1'], required: false })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  houseIds?: string[];
}
