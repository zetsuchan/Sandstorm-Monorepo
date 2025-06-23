import { BootcBuilder, BootcImageSpec } from '../src';

async function buildCustomImage() {
  const builder = new BootcBuilder();

  // Example 1: Basic Python development environment
  const pythonDevSpec: BootcImageSpec = {
    baseImage: 'quay.io/fedora/fedora-bootc:40',
    dockerfile: `
# Install Python and development tools
RUN dnf install -y python3 python3-pip python3-devel gcc g++ make git

# Install common Python packages
RUN pip3 install numpy pandas matplotlib scikit-learn jupyter

# Set up development user
RUN useradd -m -s /bin/bash developer
USER developer
WORKDIR /home/developer
`,
    packages: ['vim', 'tmux', 'htop'],
    bootType: 'efi',
  };

  console.log('Building Python development image...');
  const pythonResult = await builder.buildImage(pythonDevSpec);
  console.log('Python image built:', {
    hash: pythonResult.imageHash,
    size: `${(pythonResult.imageSize / 1024 / 1024).toFixed(2)} MB`,
    buildTime: `${(pythonResult.buildTime / 1000).toFixed(2)}s`,
  });

  // Example 2: Machine Learning workstation with GPU support
  const mlWorkstationSpec: BootcImageSpec = {
    baseImage: 'quay.io/fedora/fedora-bootc:40',
    dockerfile: `
# Install NVIDIA drivers and CUDA
RUN dnf install -y akmod-nvidia xorg-x11-drv-nvidia-cuda

# Install Python and ML frameworks
RUN dnf install -y python3 python3-pip
RUN pip3 install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu118
RUN pip3 install tensorflow transformers datasets accelerate

# Install Jupyter and extensions
RUN pip3 install jupyter jupyterlab ipywidgets

# Configure systemd service for Jupyter
`,
    systemdUnits: [
      {
        name: 'jupyter.service',
        content: `[Unit]
Description=Jupyter Lab Server
After=network.target

[Service]
Type=simple
User=developer
WorkingDirectory=/home/developer
ExecStart=/usr/local/bin/jupyter lab --ip=0.0.0.0 --no-browser
Restart=always

[Install]
WantedBy=multi-user.target`,
      },
    ],
    kernelArgs: ['nvidia-drm.modeset=1'],
    bootType: 'efi',
  };

  console.log('\nBuilding ML workstation image...');
  const mlResult = await builder.buildImage(mlWorkstationSpec);
  console.log('ML workstation image built:', {
    hash: mlResult.imageHash,
    size: `${(mlResult.imageSize / 1024 / 1024).toFixed(2)} MB`,
    layers: mlResult.layers.length,
  });

  // Example 3: Kubernetes node image
  const k8sNodeSpec: BootcImageSpec = {
    baseImage: 'quay.io/fedora/fedora-bootc:40',
    dockerfile: `
# Install container runtime
RUN dnf install -y cri-o cri-tools

# Install Kubernetes components
RUN cat <<EOF | tee /etc/yum.repos.d/kubernetes.repo
[kubernetes]
name=Kubernetes
baseurl=https://packages.cloud.google.com/yum/repos/kubernetes-el7-x86_64
enabled=1
gpgcheck=1
gpgkey=https://packages.cloud.google.com/yum/doc/rpm-package-key.gpg
EOF

RUN dnf install -y kubelet kubeadm kubectl

# Configure networking
RUN modprobe br_netfilter
RUN echo 'net.bridge.bridge-nf-call-iptables = 1' >> /etc/sysctl.conf
RUN echo 'net.ipv4.ip_forward = 1' >> /etc/sysctl.conf
`,
    systemdUnits: [
      {
        name: 'kubelet.service',
        content: `[Unit]
Description=kubelet: The Kubernetes Node Agent
Documentation=https://kubernetes.io/docs/home/
Wants=network-online.target
After=network-online.target

[Service]
ExecStart=/usr/bin/kubelet
Restart=always
StartLimitInterval=0
RestartSec=10

[Install]
WantedBy=multi-user.target`,
      },
    ],
    packages: ['iptables', 'iproute', 'socat', 'util-linux', 'ethtool'],
    bootType: 'efi',
  };

  console.log('\nBuilding Kubernetes node image...');
  const k8sResult = await builder.buildImage(k8sNodeSpec);
  console.log('Kubernetes node image built:', {
    hash: k8sResult.imageHash,
    digest: k8sResult.ociDigest,
  });

  // Push images to registry
  const registry = process.env.BOOTC_REGISTRY || 'localhost:5000';
  
  console.log(`\nPushing images to ${registry}...`);
  await builder.pushImage(pythonResult.imageHash, registry);
  await builder.pushImage(mlResult.imageHash, registry);
  await builder.pushImage(k8sResult.imageHash, registry);
  
  console.log('All images pushed successfully!');

  // Cleanup old images
  console.log('\nCleaning up old images...');
  const deleted = await builder.cleanupImages(7); // Remove images older than 7 days
  console.log(`Deleted ${deleted} old images`);
}

// Run the example
buildCustomImage().catch(console.error);