import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Testing Library auto-cleans only when `globals: true` is set, because it
// hooks the *global* afterEach. This project runs without globals, so without
// this every render() leaks into the next test and `getBy*` starts finding
// duplicates from tests that already passed.
afterEach(cleanup);
