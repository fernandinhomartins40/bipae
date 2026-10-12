import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// The register boots a real SQLite database; under a busy CI machine 1 s is too tight.
configure({ asyncUtilTimeout: 5000 });
afterEach(cleanup);
