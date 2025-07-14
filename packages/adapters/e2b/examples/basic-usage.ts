import { E2BProvider } from '../src';

async function main() {
  // Initialize the E2B provider
  const provider = new E2BProvider({
    apiKey: process.env.E2B_API_KEY || '',
    defaultTimeout: 60000, // 60 seconds
  });

  // Check if E2B is available
  const isAvailable = await provider.isAvailable();
  console.log('E2B Available:', isAvailable);

  if (!isAvailable) {
    console.error('E2B is not available. Please check your API key.');
    return;
  }

  // Example 1: Simple Python code execution
  console.log('\n--- Example 1: Simple Python Execution ---');
  const pythonResult = await provider.run({
    code: `
import sys
print(f"Python version: {sys.version}")
print("Hello from E2B!")

# Calculate fibonacci
def fibonacci(n):
    if n <= 1:
        return n
    return fibonacci(n-1) + fibonacci(n-2)

for i in range(10):
    print(f"fibonacci({i}) = {fibonacci(i)}")
`,
    language: 'python',
    timeout: 30000,
  });

  console.log('Python Output:', pythonResult.stdout);
  console.log('Exit Code:', pythonResult.exitCode);
  console.log('Duration:', pythonResult.duration, 'ms');
  console.log('Cost: $', pythonResult.cost.toFixed(6));

  // Example 2: JavaScript code with file operations
  console.log('\n--- Example 2: JavaScript with Files ---');
  const jsResult = await provider.run({
    code: `
const fs = require('fs');

// Read input file
const input = fs.readFileSync('input.txt', 'utf8');
console.log('Input file contents:', input);

// Process data
const processed = input.toUpperCase() + '\\n\\nProcessed by E2B!';

// Write output file
fs.writeFileSync('output.txt', processed);
console.log('File processed successfully!');
`,
    language: 'javascript',
    files: {
      'input.txt': 'Hello, this is a test file for E2B processing.',
    },
    timeout: 30000,
  });

  console.log('JS Output:', jsResult.stdout);
  console.log('Output Files:', jsResult.files);

  // Example 3: Python with package installation
  console.log('\n--- Example 3: Python with Package Installation ---');
  const packageResult = await provider.run({
    code: `
# Install and use a package
import subprocess
import sys

# Install requests package
subprocess.check_call([sys.executable, "-m", "pip", "install", "requests", "--quiet"])

# Now use the installed package
import requests

response = requests.get('https://api.github.com')
print(f"GitHub API Status: {response.status_code}")
print(f"Rate Limit Remaining: {response.headers.get('X-RateLimit-Remaining', 'N/A')}")
`,
    language: 'python',
    timeout: 60000, // Longer timeout for package installation
  });

  console.log('Package Installation Output:', packageResult.stdout);

  // Example 4: Data visualization with matplotlib
  console.log('\n--- Example 4: Data Visualization ---');
  const vizResult = await provider.run({
    code: `
import matplotlib.pyplot as plt
import numpy as np

# Generate sample data
x = np.linspace(0, 10, 100)
y1 = np.sin(x)
y2 = np.cos(x)

# Create plot
plt.figure(figsize=(10, 6))
plt.plot(x, y1, label='sin(x)', linewidth=2)
plt.plot(x, y2, label='cos(x)', linewidth=2)
plt.xlabel('X')
plt.ylabel('Y')
plt.title('Sine and Cosine Functions')
plt.legend()
plt.grid(True, alpha=0.3)

# Save the plot
plt.savefig('plot.png', dpi=150, bbox_inches='tight')
print("Plot saved as plot.png")

# Also create a data file
import json
data = {
    'x': x.tolist(),
    'sin': y1.tolist(),
    'cos': y2.tolist()
}
with open('data.json', 'w') as f:
    json.dump(data, f)
print("Data saved as data.json")
`,
    language: 'python',
    timeout: 30000,
  });

  console.log('Visualization Output:', vizResult.stdout);
  console.log('Generated Files:', Object.keys(vizResult.files || {}));

  // Example 5: Error handling
  console.log('\n--- Example 5: Error Handling ---');
  try {
    const errorResult = await provider.run({
      code: `
# This will cause an error
print("Starting execution...")
raise ValueError("This is a test error!")
print("This won't be printed")
`,
      language: 'python',
      timeout: 10000,
    });
    
    console.log('Error Output:', errorResult.stderr);
    console.log('Exit Code:', errorResult.exitCode);
  } catch (error) {
    console.error('Caught error:', error);
  }

  // Cost estimation examples
  console.log('\n--- Cost Estimation Examples ---');
  
  const basicCost = await provider.estimateCost({
    code: 'print("test")',
    language: 'python',
    timeout: 5000,
  });
  console.log('Basic 5s execution cost: $', basicCost.toFixed(6));

  const gpuCost = await provider.estimateCost({
    code: 'print("test")',
    language: 'python',
    timeout: 60000,
    gpu: true,
  });
  console.log('GPU 60s execution cost: $', gpuCost.toFixed(6));

  const highMemCost = await provider.estimateCost({
    code: 'print("test")',
    language: 'python',
    timeout: 30000,
    memory: 8192,
  });
  console.log('High memory 30s execution cost: $', highMemCost.toFixed(6));

  // Cleanup
  await provider.cleanup();
}

// Run the examples
main().catch(console.error);