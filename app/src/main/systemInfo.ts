import os from 'os';
import { execFile, exec } from 'child_process';
import { SystemInfo, GpuInfo } from '../shared/types';
import fs from 'fs';

/**
 * Gather system information: GPU, CPU, RAM, Disk.
 */
export async function getSystemInfo(): Promise<SystemInfo> {
  const [gpus, disk] = await Promise.all([
    detectGpus(),
    getDiskSpace(),
  ]);

  return {
    gpus,
    cpuModel: os.cpus()[0]?.model || 'Unknown',
    cpuCores: os.cpus().length,
    ramTotalMB: Math.round(os.totalmem() / (1024 * 1024)),
    ramFreeMB: Math.round(os.freemem() / (1024 * 1024)),
    diskTotalGB: disk.totalGB,
    diskFreeGB: disk.freeGB,
  };
}

/**
 * Detect GPUs using vulkaninfo or fallback to WMIC on Windows.
 */
async function detectGpus(): Promise<GpuInfo[]> {
  // Try vulkaninfo first
  try {
    const vulkanResult = await execCommand('vulkaninfo --summary');
    const gpus = parseVulkanInfo(vulkanResult);
    if (gpus.length > 0) return gpus;
  } catch {
    // vulkaninfo not available, fallback
  }

  // Windows fallback: WMIC
  if (process.platform === 'win32') {
    try {
      const wmicResult = await execCommand(
        'wmic path win32_VideoController get Name,AdapterRAM,DriverVersion /format:csv'
      );
      return parseWmicGpuInfo(wmicResult);
    } catch {
      // WMIC not available
    }
  }

  return [{ id: 0, name: 'Unknown GPU', vendor: 'Unknown', vramMB: 0 }];
}

function parseVulkanInfo(output: string): GpuInfo[] {
  const gpus: GpuInfo[] = [];
  const deviceBlocks = output.split(/GPU\d+/i);

  let id = 0;
  for (const block of deviceBlocks) {
    const nameMatch = block.match(/deviceName\s*=\s*(.+)/i);
    const vendorMatch = block.match(/vendorID\s*=\s*0x([0-9a-fA-F]+)/i);
    const memMatch = block.match(/heapSize\s*=\s*(\d+)/i);

    if (nameMatch) {
      const vendorId = vendorMatch ? parseInt(vendorMatch[1], 16) : 0;
      let vendor = 'Unknown';
      if (vendorId === 0x10de) vendor = 'NVIDIA';
      else if (vendorId === 0x1002) vendor = 'AMD';
      else if (vendorId === 0x8086) vendor = 'Intel';

      gpus.push({
        id: id++,
        name: nameMatch[1].trim(),
        vendor,
        vramMB: memMatch ? Math.round(parseInt(memMatch[1], 10) / (1024 * 1024)) : 0,
      });
    }
  }

  return gpus;
}

function parseWmicGpuInfo(output: string): GpuInfo[] {
  const gpus: GpuInfo[] = [];
  const lines = output.split('\n').filter((l) => l.trim().length > 0);

  let id = 0;
  for (let i = 1; i < lines.length; i++) {
    const parts = lines[i].split(',');
    if (parts.length >= 3) {
      const vramBytes = parseInt(parts[1], 10) || 0;
      const name = parts[2]?.trim() || 'Unknown GPU';

      let vendor = 'Unknown';
      if (name.toLowerCase().includes('nvidia')) vendor = 'NVIDIA';
      else if (name.toLowerCase().includes('amd') || name.toLowerCase().includes('radeon'))
        vendor = 'AMD';
      else if (name.toLowerCase().includes('intel')) vendor = 'Intel';

      gpus.push({
        id: id++,
        name,
        vendor,
        vramMB: Math.round(vramBytes / (1024 * 1024)),
      });
    }
  }

  return gpus.length > 0
    ? gpus
    : [{ id: 0, name: 'Unknown GPU', vendor: 'Unknown', vramMB: 0 }];
}

async function getDiskSpace(): Promise<{ totalGB: number; freeGB: number }> {
  if (process.platform === 'win32') {
    try {
      const result = await execCommand(
        'wmic logicaldisk where "DeviceID=\'C:\'" get Size,FreeSpace /format:csv'
      );
      const lines = result.split('\n').filter((l) => l.trim());
      if (lines.length >= 2) {
        const parts = lines[1].split(',');
        const free = parseInt(parts[1], 10) || 0;
        const total = parseInt(parts[2], 10) || 0;
        return {
          totalGB: Math.round((total / (1024 * 1024 * 1024)) * 10) / 10,
          freeGB: Math.round((free / (1024 * 1024 * 1024)) * 10) / 10,
        };
      }
    } catch {
      // fallback
    }
  }

  // Linux/Mac fallback
  try {
    const stats = fs.statfsSync('/');
    return {
      totalGB:
        Math.round(((stats.blocks * stats.bsize) / (1024 * 1024 * 1024)) * 10) / 10,
      freeGB:
        Math.round(((stats.bfree * stats.bsize) / (1024 * 1024 * 1024)) * 10) / 10,
    };
  } catch {
    return { totalGB: 0, freeGB: 0 };
  }
}

function execCommand(cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { windowsHide: true, timeout: 10000 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}
