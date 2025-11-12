# E2B Adapter Tests

This directory contains tests for the E2B provider adapter.

## Test Types

### Unit Tests (`unit.test.ts`)
Tests pure logic without making API calls:
- Configuration validation
- Cost estimation calculations
- Latency estimation
- Language mapping
- Error message formatting

**Run unit tests:**
```bash
bun test unit.test.ts
```

### Integration Tests (`integration.test.ts`)
Tests real E2B API behavior:
- Actual sandbox execution
- Real error handling
- Timeout behavior
- Resource management
- Cost tracking

**Run integration tests:**
```bash
# Set up environment
export E2B_API_KEY=your-e2b-api-key
export RUN_INTEGRATION_TESTS=1

# Run tests
bun test integration.test.ts
```

## Getting an E2B API Key

1. Sign up at https://e2b.dev
2. Navigate to your dashboard
3. Create a new API key
4. Copy the key and set it as an environment variable

## Cost Considerations

Integration tests make real API calls and will incur small costs:
- **Total cost per test run**: ~$0.01-0.02
- **Individual test cost**: ~$0.0001-0.001
- Tests use minimal resources (128MB RAM, 0.5 CPU)
- Short timeouts (5-10 seconds)
- Automatic cost tracking and reporting

## Running All Tests

```bash
# Unit tests only (free, fast)
bun test unit.test.ts

# All tests (requires API key, costs ~$0.01)
E2B_API_KEY=your-key RUN_INTEGRATION_TESTS=1 bun test

# With coverage
E2B_API_KEY=your-key RUN_INTEGRATION_TESTS=1 bun test --coverage
```

## CI/CD

Integration tests are gated in CI:
- Only run on main branch
- Require `E2B_API_KEY` secret
- Can be triggered with label `run-integration-tests`

## Test Structure

```
__tests__/
├── README.md              # This file
├── unit.test.ts           # Pure logic tests (fast, no API)
└── integration.test.ts    # Real API tests (slow, costs money)
```

## Troubleshooting

### "E2B_API_KEY not set"
Make sure you've exported the API key:
```bash
export E2B_API_KEY=your-key-here
```

### "Tests skipped"
Set the integration test flag:
```bash
export RUN_INTEGRATION_TESTS=1
```

### "Rate limit exceeded"
E2B has rate limits. Wait a moment and try again, or add delays between tests.

### "Quota exceeded"
You've hit your E2B usage quota. Check your dashboard and add credits if needed.

## Best Practices

1. **Run unit tests frequently** - They're fast and free
2. **Run integration tests before commits** - Catch real bugs
3. **Monitor costs** - Check the cost summary at the end of test runs
4. **Use test API keys** - Set up a separate key for testing with low quotas
5. **Clean up resources** - Tests automatically clean up, but verify in your dashboard

## Coverage Goals

- **Unit tests**: 80%+ coverage of pure logic
- **Integration tests**: 60%+ coverage of API interactions
- **Total**: 70%+ combined coverage
