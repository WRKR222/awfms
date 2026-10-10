// Unit tests live next to the source; never pick up the compiled copies
// that `nest build` writes to dist/.
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    exclude: [...configDefaults.exclude, 'dist/**'],
  },
});
