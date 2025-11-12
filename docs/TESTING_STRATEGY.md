# Sandstorm Testing Strategy 2025

This document outlines best practices and patterns for testing provider adapters, external API integrations, and the Sandstorm routing layer.

## Table of Contents

1. [Testing Philosophy](#testing-philosophy)
2. [Test Types & Coverage Goals](#test-types--coverage-goals)
3. [Bun Test Framework Best Practices](#bun-test-framework-best-practices)
4. [Mocking Strategies](#mocking-strategies)
5. [Provider Adapter Testing](#provider-adapter-testing)
6. [Integration Testing](#integration-testing)
7. [Test Organization](#test-organization)
8. [CI/CD Integration](#cicd-integration)

---

## Testing Philosophy

### Core Principles

1. **Fast Feedback**: Unit tests should run in <100ms, full suite in <10s
2. **Isolation**: Tests should not depend on external services by default
3. **Realism**: Integration tests should use real APIs when safe and practical
4. **Coverage**: Aim for 70%+ on adapters, 80%+ on core routing logic
5. **Maintainability**: Tests should be as simple as possible while being thorough

### Test Pyramid for Sandstorm

```
        /\
       /  \     E2E Tests (5%)
      /    \    - Full routing flow
     /------\   - Multi-provider failover
    /        \
   /  Integ.  \ Integration Tests (25%)
  /   Tests    \ - Real API calls (gated)
 /--------------\ - Provider health checks
/                \
/  Unit Tests     \ Unit Tests (70%)
/  (Mocked APIs)   \ - Adapter logic
--------------------  - Cost calculation
                      - Error handling
```

---

## Test Types & Coverage Goals

### 1. Unit Tests (70% of suite)
**Goal**: Test adapter logic in isolation

**Coverage targets**:
- Core logic: 80%+
- Edge cases: 100%
- Error handling: 100%

**What to test**:
- Cost estimation algorithms
- Latency prediction
- Language/image mapping
- Configuration validation
- Error message formatting
- Retry logic

**Example**:
```typescript
describe('E2BAdapter - Unit Tests', () => {
  it('should calculate cost correctly', async () => {
    const adapter = new E2BAdapter({ apiKey: 'mock' });
    const spec: SandboxSpec = {
      code: 'print("test")',
      language: 'python',
      timeout: 60000, // 1 minute
    };

    const cost = await adapter.estimateCost(spec);
    // Base: $0.00014/sec * 60 seconds = $0.0084
    expect(cost).toBeCloseTo(0.0084, 4);
  });
});
```

### 2. Integration Tests (25% of suite)
**Goal**: Test real API interactions

**Gated by**: `RUN_INTEGRATION_TESTS=1` environment variable

**Coverage targets**:
- Happy path: 100%
- Provider error handling: 80%
- Quota exhaustion: 100%

**What to test**:
- Actual sandbox execution
- Real API error responses
- Rate limiting behavior
- Connection failures
- Timeout handling

**Example**:
```typescript
it.if(process.env.RUN_INTEGRATION_TESTS)(
  'should run real sandbox on E2B',
  async () => {
    const adapter = new E2BAdapter({
      apiKey: process.env.E2B_API_KEY!
    });

    const result = await adapter.run({
      code: 'import sys; print(sys.version)',
      language: 'python',
      isolationLevel: 'standard',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('3.11');
  },
  30000 // 30s timeout
);
```

### 3. E2E Tests (5% of suite)
**Goal**: Test complete routing flow

**What to test**:
- Arbitrage engine provider selection
- Failover between providers
- Telemetry collection
- Cost tracking

---

## Bun Test Framework Best Practices

### Test File Structure

```typescript
import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';

describe('ComponentName', () => {
  // Setup
  let instance: ComponentType;

  beforeEach(() => {
    // Fresh instance for each test
    instance = new ComponentType();
  });

  afterEach(() => {
    // Cleanup
    instance.cleanup?.();
  });

  describe('feature group', () => {
    it('should do something specific', () => {
      // Arrange
      const input = 'test';

      // Act
      const result = instance.doSomething(input);

      // Assert
      expect(result).toBe('expected');
    });
  });
});
```

### Async Testing

```typescript
// Preferred: Use async/await
it('should handle async operations', async () => {
  const result = await adapter.run(spec);
  expect(result.exitCode).toBe(0);
});

// Avoid: done callback (unless necessary)
it('handles callback', (done) => {
  adapter.run(spec, (err, result) => {
    expect(err).toBeNull();
    done();
  });
});
```

### Conditional Tests

```typescript
// Run only if environment variable set
it.if(process.env.RUN_INTEGRATION_TESTS)(
  'integration test',
  async () => { /* ... */ }
);

// Run only on specific platform
it.if(process.platform === 'darwin')(
  'macOS-specific test',
  () => { /* ... */ }
);

// Skip test
it.skip('not yet implemented', () => {
  // Will not run
});
```

### Timeout Configuration

```typescript
// Default timeout: 5000ms
it('fast test', () => {
  expect(true).toBe(true);
});

// Custom timeout for slow operations
it('slow integration test', async () => {
  await longRunningOperation();
}, 60000); // 60 seconds
```

### Test Coverage

```bash
# Generate coverage report
bun test --coverage

# Coverage with threshold
bun test --coverage --coverage-threshold=80
```

---

## Mocking Strategies

### 1. Mock Service Worker (MSW) - Recommended for HTTP APIs

**When to use**: Testing adapters that make HTTP requests (E2B, Modal, Daytona)

**Benefits**:
- Intercepts at network level
- Works with any HTTP client (axios, fetch, etc.)
- More realistic than module mocking
- Can be shared across tests

**Example**:
```typescript
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

// Setup mock server
const server = setupServer(
  http.post('https://api.e2b.dev/sandboxes', () => {
    return HttpResponse.json({
      sandbox_id: 'mock-123',
      status: 'running'
    });
  })
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

it('should create sandbox via API', async () => {
  const adapter = new E2BAdapter({ apiKey: 'test' });
  const result = await adapter.run(spec);
  expect(result.sandboxId).toBe('mock-123');
});
```

### 2. Bun Mock Functions - For Module/Class Mocking

**When to use**: Testing classes that depend on other modules

**Example**:
```typescript
import { mock } from 'bun:test';

// Mock a module
mock.module('@e2b/code-interpreter', () => ({
  CodeInterpreter: class MockInterpreter {
    create() {
      return { id: 'mock-123' };
    }
  }
}));

// Mock a method
const mockExec = mock(() => Promise.resolve({
  stdout: 'mocked output',
  stderr: '',
  exit_code: 0
}));

instance.exec = mockExec;
```

### 3. Test Doubles - For Provider Interfaces

**When to use**: Testing arbitrage engine and routing logic

**Example**:
```typescript
class MockProvider implements SandboxProvider {
  async run(spec: SandboxSpec): Promise<SandboxResult> {
    return {
      stdout: 'mock output',
      stderr: '',
      exitCode: 0,
      provider: 'mock',
      executionTime: 100,
      cost: 0.001,
    };
  }

  async estimateCost(spec: SandboxSpec): Promise<number> {
    return 0.001;
  }

  async estimateLatency(spec: SandboxSpec): Promise<number> {
    return 100;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }

  // ... implement other methods
}

// Use in tests
const engine = new ArbitrageEngine({
  providers: [new MockProvider()]
});
```

### 4. Fixture Data - For Consistent Test Data

**Structure**:
```
packages/adapters/*/src/__tests__/
├── fixtures/
│   ├── sandbox-specs.ts
│   ├── api-responses.ts
│   └── error-cases.ts
└── provider.test.ts
```

**Example**:
```typescript
// fixtures/sandbox-specs.ts
export const pythonSpec: SandboxSpec = {
  code: 'print("Hello, World!")',
  language: 'python',
  isolationLevel: 'standard',
};

export const nodejsSpec: SandboxSpec = {
  code: 'console.log("Hello, World!")',
  language: 'javascript',
  isolationLevel: 'standard',
};

// fixtures/api-responses.ts
export const e2bSuccessResponse = {
  sandbox_id: 'test-123',
  status: 'running',
  created_at: '2025-01-01T00:00:00Z',
};

export const e2bErrorResponse = {
  error: 'quota_exceeded',
  message: 'Monthly quota exceeded',
};
```

---

## Provider Adapter Testing

### Test Structure for Each Adapter

Every adapter should have the following test suites:

```typescript
describe('ProviderAdapter', () => {
  describe('initialization', () => {
    it('should initialize with valid config');
    it('should throw on invalid config');
  });

  describe('availability', () => {
    it('should check provider availability');
    it('should handle network errors');
  });

  describe('cost estimation', () => {
    it('should calculate cost for basic spec');
    it('should calculate cost for GPU spec');
    it('should handle missing timeout');
  });

  describe('latency estimation', () => {
    it('should estimate cold start latency');
    it('should estimate warm start latency');
  });

  describe('sandbox execution', () => {
    describe('unit tests (mocked)', () => {
      it('should handle successful execution');
      it('should handle timeout errors');
      it('should handle out of memory errors');
      it('should handle network errors');
      it('should retry on transient failures');
    });

    describe.if(process.env.RUN_INTEGRATION_TESTS)('integration tests', () => {
      it('should run real Python sandbox');
      it('should run real Node.js sandbox');
      it('should handle real timeout');
      it('should respect resource limits');
    });
  });

  describe('error handling', () => {
    it('should handle quota exceeded');
    it('should handle invalid API key');
    it('should handle rate limiting');
    it('should format error messages correctly');
  });

  describe('snapshots', () => {
    it('should create snapshot');
    it('should restore from snapshot');
    it('should list snapshots');
  });

  describe('cleanup', () => {
    it('should cleanup active sandboxes');
    it('should handle cleanup errors gracefully');
  });
});
```

### Contract Testing

Ensure all adapters implement the `SandboxProvider` interface consistently:

```typescript
// shared-tests/provider-contract.test.ts
export function testProviderContract(
  createProvider: () => SandboxProvider,
  providerName: string
) {
  describe(`${providerName} - Provider Contract`, () => {
    let provider: SandboxProvider;

    beforeEach(() => {
      provider = createProvider();
    });

    it('should implement run method', async () => {
      const result = await provider.run(basicSpec);
      expect(result).toHaveProperty('stdout');
      expect(result).toHaveProperty('stderr');
      expect(result).toHaveProperty('exitCode');
      expect(result).toHaveProperty('provider');
    });

    it('should implement estimateCost method', async () => {
      const cost = await provider.estimateCost(basicSpec);
      expect(typeof cost).toBe('number');
      expect(cost).toBeGreaterThanOrEqual(0);
    });

    // ... test all interface methods
  });
}

// In each adapter's test file:
testProviderContract(
  () => new E2BAdapter({ apiKey: 'test' }),
  'E2B'
);
```

### Testing Error Scenarios

```typescript
describe('error scenarios', () => {
  it('should handle quota exceeded', async () => {
    server.use(
      http.post('https://api.e2b.dev/sandboxes', () => {
        return HttpResponse.json(
          { error: 'quota_exceeded' },
          { status: 429 }
        );
      })
    );

    await expect(adapter.run(spec)).rejects.toThrow('Quota exceeded');
  });

  it('should retry on 503 errors', async () => {
    let attempts = 0;
    server.use(
      http.post('https://api.e2b.dev/sandboxes', () => {
        attempts++;
        if (attempts < 3) {
          return HttpResponse.json(
            { error: 'service_unavailable' },
            { status: 503 }
          );
        }
        return HttpResponse.json({ sandbox_id: 'success' });
      })
    );

    const result = await adapter.run(spec);
    expect(result.sandboxId).toBe('success');
    expect(attempts).toBe(3);
  });
});
```

---

## Integration Testing

### Safe Integration Test Practices

```typescript
describe.if(process.env.RUN_INTEGRATION_TESTS)('integration tests', () => {
  // Use test accounts with low quotas
  const adapter = new E2BAdapter({
    apiKey: process.env.E2B_TEST_API_KEY!
  });

  // Clean up after tests
  afterEach(async () => {
    await adapter.cleanup();
  });

  it('should run real sandbox', async () => {
    // Use small, fast tests
    const spec: SandboxSpec = {
      code: 'print("test")',
      language: 'python',
      timeout: 5000, // Short timeout
      memory: 128, // Minimal memory
    };

    const result = await adapter.run(spec);
    expect(result.exitCode).toBe(0);
  }, 30000);
});
```

### Integration Test Guidelines

1. **Use dedicated test accounts** with separate API keys
2. **Set low quotas** to prevent runaway costs
3. **Keep tests small** - minimal code, minimal resources
4. **Clean up resources** - delete sandboxes after tests
5. **Use timeouts** - prevent hanging tests
6. **Run in CI sparingly** - maybe only on main branch
7. **Monitor costs** - track integration test spending

---

## Test Organization

### Directory Structure

```
packages/adapters/e2b/
├── src/
│   ├── __tests__/
│   │   ├── fixtures/
│   │   │   ├── sandbox-specs.ts
│   │   │   └── api-responses.ts
│   │   ├── unit/
│   │   │   ├── cost-estimation.test.ts
│   │   │   ├── error-handling.test.ts
│   │   │   └── retry-logic.test.ts
│   │   ├── integration/
│   │   │   ├── real-execution.test.ts
│   │   │   └── quota-handling.test.ts
│   │   └── provider.test.ts (main test file)
│   └── provider.ts
└── package.json
```

### Shared Test Utilities

```typescript
// packages/test-utils/src/index.ts
export * from './mock-providers';
export * from './fixtures';
export * from './helpers';

// packages/test-utils/src/helpers.ts
export async function waitForSandbox(
  adapter: SandboxProvider,
  sandboxId: string,
  maxWaitMs = 30000
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < maxWaitMs) {
    const status = await adapter.getStatus(sandboxId);
    if (status === 'running') return;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  throw new Error('Sandbox did not start in time');
}

export function expectSandboxResult(result: SandboxResult) {
  expect(result).toHaveProperty('stdout');
  expect(result).toHaveProperty('stderr');
  expect(result).toHaveProperty('exitCode');
  expect(result).toHaveProperty('provider');
  expect(typeof result.executionTime).toBe('number');
  expect(typeof result.cost).toBe('number');
}
```

---

## CI/CD Integration

### GitHub Actions Workflow

```yaml
# .github/workflows/test.yml
name: Tests

on: [push, pull_request]

jobs:
  unit-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Run unit tests
        run: bun test --coverage

      - name: Upload coverage
        uses: codecov/codecov-action@v3
        with:
          files: ./coverage/coverage-final.json

  integration-tests:
    runs-on: ubuntu-latest
    # Only run on main branch or with label
    if: github.ref == 'refs/heads/main' || contains(github.event.pull_request.labels.*.name, 'run-integration-tests')
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v1

      - name: Install dependencies
        run: bun install --frozen-lockfile

      - name: Run integration tests
        env:
          RUN_INTEGRATION_TESTS: 1
          E2B_API_KEY: ${{ secrets.E2B_TEST_API_KEY }}
          MODAL_API_KEY: ${{ secrets.MODAL_TEST_API_KEY }}
          DAYTONA_API_KEY: ${{ secrets.DAYTONA_TEST_API_KEY }}
        run: bun test --timeout=60000
```

### Test Scripts in package.json

```json
{
  "scripts": {
    "test": "bun test",
    "test:unit": "bun test --coverage",
    "test:integration": "RUN_INTEGRATION_TESTS=1 bun test --timeout=60000",
    "test:watch": "bun test --watch",
    "test:ci": "bun test --coverage --bail"
  }
}
```

---

## Performance Testing

### Benchmarking Provider Performance

```typescript
import { bench, describe } from 'bun:test';

describe('Provider Performance', () => {
  bench('E2B cost estimation', async () => {
    await e2bAdapter.estimateCost(spec);
  });

  bench('Modal cost estimation', async () => {
    await modalAdapter.estimateCost(spec);
  });

  bench('Arbitrage engine selection', async () => {
    await arbitrageEngine.selectProvider(spec);
  });
});
```

---

## Coverage Goals

### Minimum Coverage Requirements

| Component | Unit Tests | Integration Tests |
|-----------|-----------|-------------------|
| **Provider Adapters** | 70% | 50% |
| **Arbitrage Engine** | 85% | 60% |
| **ML Router** | 80% | 40% |
| **Security Module** | 90% | 30% |
| **SDK** | 75% | 50% |
| **Gateway (Rust)** | 80% | 60% |

### Coverage Command

```bash
# Generate HTML coverage report
bun test --coverage --coverage-dir=./coverage

# View coverage report
open coverage/index.html

# Enforce minimum coverage
bun test --coverage --coverage-threshold=70
```

---

## Best Practices Summary

### ✅ DO

- Write tests before or immediately after implementation (TDD)
- Use descriptive test names that explain what is being tested
- Follow Arrange-Act-Assert pattern
- Mock external APIs for unit tests
- Use fixtures for consistent test data
- Gate integration tests with environment variables
- Clean up resources after tests
- Test error cases and edge cases
- Use Bun's built-in features (mock, spyOn, coverage)
- Keep tests fast (<100ms for unit tests)

### ❌ DON'T

- Hit real APIs in unit tests
- Share state between tests
- Use `it.only` or `describe.only` in committed code
- Skip cleanup in `afterEach`
- Test implementation details
- Write overly complex test logic
- Ignore flaky tests (fix them!)
- Commit code without tests
- Mock what you don't own (prefer MSW for HTTP)
- Use magic numbers without explanation

---

## Next Steps

1. Review this document with the team
2. Implement tests for E2B adapter following these patterns
3. Apply learnings to Modal and Daytona adapters
4. Set up CI/CD with proper test gating
5. Monitor coverage and improve over time
6. Update this document as patterns evolve

---

## Resources

- [Bun Test Documentation](https://bun.sh/docs/cli/test)
- [Mock Service Worker](https://mswjs.io/)
- [Node.js Testing Best Practices](https://github.com/goldbergyoni/nodejs-testing-best-practices)
- [Test Driven Development](https://en.wikipedia.org/wiki/Test-driven_development)
