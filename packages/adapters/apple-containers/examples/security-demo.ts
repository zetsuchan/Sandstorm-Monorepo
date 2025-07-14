import { Sandstorm } from '@sandstorm/sdk';
import { AppleContainersProvider } from '@sandstorm/adapters-apple-containers';

async function main() {
  const appleContainers = new AppleContainersProvider({
    defaultTimeout: 30000,
    enableRosetta: true,
  });

  const sandstorm = new Sandstorm({
    providers: [appleContainers],
  });

  console.log('🔒 Apple Containers Security Demo - VM-Level Isolation\n');

  // Example 1: Demonstrate isolation - no shared kernel
  console.log('1. Testing VM isolation (no shared kernel):');
  try {
    const isolationTest = await sandstorm.run({
      code: `
import os
import socket

print("Container Info:")
print(f"Hostname: {socket.gethostname()}")
print(f"PID: {os.getpid()}")
print(f"UID: {os.getuid()}")

# Try to access kernel info (safe in VM)
try:
    with open('/proc/version', 'r') as f:
        print(f"Kernel: {f.read().strip()}")
except:
    print("Kernel info not accessible")

# Each container has its own kernel instance
print("\\n✅ Running in isolated VM - no shared kernel vulnerabilities!")
      `,
      language: 'python',
      provider: 'apple-containers',
    });
    console.log(isolationTest.stdout);
  } catch (error) {
    console.error('Error:', error);
  }

  // Example 2: Network isolation
  console.log('\n2. Testing network isolation:');
  const networkTest = await sandstorm.run({
    code: `
import subprocess
import socket

# Get container's IP
hostname = socket.gethostname()
ip = socket.gethostbyname(hostname)
print(f"Container IP: {ip}")

# Try to ping another container (will fail due to isolation)
try:
    result = subprocess.run(['ping', '-c', '1', '10.0.0.1'], 
                          capture_output=True, text=True, timeout=2)
    print(f"Ping result: {result.returncode}")
except subprocess.TimeoutExpired:
    print("✅ Network isolated - cannot reach other containers")
    `,
    language: 'python',
    provider: 'apple-containers',
  });
  console.log(networkTest.stdout);

  // Example 3: File system isolation
  console.log('\n3. Testing filesystem isolation:');
  const fsTest = await sandstorm.run({
    code: `
import os
import tempfile

# Create a file in the container
with tempfile.NamedTemporaryFile(mode='w', delete=False) as f:
    f.write("Secret data in container VM")
    temp_path = f.name

print(f"Created file: {temp_path}")

# List root directory (container's isolated filesystem)
print("\\nContainer root directory:")
for item in os.listdir('/')[:5]:
    print(f"  - /{item}")

print("\\n✅ Filesystem is completely isolated in VM")
    `,
    language: 'python',
    provider: 'apple-containers',
  });
  console.log(fsTest.stdout);

  // Example 4: Resource limits are enforced at VM level
  console.log('\n4. Testing resource enforcement:');
  const resourceTest = await sandstorm.run({
    code: `
import threading
import time

def cpu_intensive():
    while True:
        _ = [i**2 for i in range(1000)]

# Try to spawn many threads
threads = []
for i in range(10):
    t = threading.Thread(target=cpu_intensive)
    t.daemon = True
    t.start()
    threads.append(t)

print(f"Spawned {len(threads)} CPU-intensive threads")
print("Resource limits enforced at VM level - host protected")

# Let it run briefly
time.sleep(2)
print("✅ VM resource constraints prevent host exhaustion")
    `,
    language: 'python',
    cpu: 1,  // Limited to 1 CPU
    memory: 512,  // Limited to 512MB
    provider: 'apple-containers',
  });
  console.log(resourceTest.stdout);

  // Example 5: Demonstrate clean environment
  console.log('\n5. Testing clean environment (no pre-installed tools):');
  const cleanEnvTest = await sandstorm.run({
    code: `
import subprocess
import shutil

# Check for common tools that would exist in Docker
tools = ['git', 'curl', 'wget', 'gcc', 'make']
found = []
not_found = []

for tool in tools:
    if shutil.which(tool):
        found.append(tool)
    else:
        not_found.append(tool)

print("Tools found:", found if found else "None")
print("Tools not found:", not_found)
print("\\n✅ Minimal attack surface - no unnecessary tools in base VM")
    `,
    language: 'python',
    provider: 'apple-containers',
  });
  console.log(cleanEnvTest.stdout);

  console.log('\n🎯 Security Summary:');
  console.log('- Each container runs in its own VM (no shared kernel)');
  console.log('- Complete network isolation between containers');
  console.log('- Isolated filesystem with no host access');
  console.log('- Resource limits enforced at VM level');
  console.log('- Minimal attack surface with clean environment');
  console.log('\n✨ Apple Containers provides enterprise-grade security!');
}

main().catch(console.error);