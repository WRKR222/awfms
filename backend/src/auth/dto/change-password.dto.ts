import { IsString, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class ChangePasswordDto {
  @Transform(trim)
  @IsString()
  currentPassword: string;

  @Transform(trim)
  @IsString()
  @MinLength(8)
  newPassword: string;
}
