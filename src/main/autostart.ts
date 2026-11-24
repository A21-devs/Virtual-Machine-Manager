import type { VmConfig } from '@shared/config'
import type { AutostartIssue, StartResult } from '@shared/ipc'

/**
 * Starts every VM marked for auto-start, one after another so they don't all fight
 * over the disk at once. A VM that fails doesn't stop the rest. Returns what the
 * user has to hear about: VMs that didn't start, and ones that started with a warning.
 */
export async function runAutostart(
  configs: VmConfig[],
  startVm: (name: string, resume: boolean) => Promise<StartResult>
): Promise<AutostartIssue[]> {
  const issues: AutostartIssue[] = []
  for (const cfg of configs.filter((c) => c.autostart)) {
    try {
      const r = await startVm(cfg.name, cfg.resumeLast)
      if (r.warning) issues.push({ name: cfg.name, warning: r.warning })
    } catch (e) {
      issues.push({ name: cfg.name, error: e instanceof Error ? e.message : String(e) })
    }
  }
  return issues
}
