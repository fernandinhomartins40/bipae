import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// Under a busy machine (all packages testing in parallel) 1 s is too tight.
configure({ asyncUtilTimeout: 5000 });
afterEach(cleanup);
