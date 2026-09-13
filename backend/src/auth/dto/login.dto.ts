import { IsString, MinLength, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

// Leading/trailing whitespace on username or password is never intentional —
// it's almost always an artifact of mobile keyboards, autofill, or copy-
// pasting credentials from WhatsApp/SMS (which frequently appends a trailing
// space or newline). Left untrimmed, the exact-match checks in
// AuthService.login would silently reject perfectly correct credentials on
// whichever device happens to introduce the stray whitespace — a classic
// "works on my phone, not on hers" bug report.
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class LoginDto {
  @ApiProperty({ example: 'james.attendant' })
  @Transform(trim)
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  username: string;

  @ApiProperty({ example: 'SecurePass123!' })
  @Transform(trim)
  @IsString()
  @MinLength(8)
  password: string;
}
