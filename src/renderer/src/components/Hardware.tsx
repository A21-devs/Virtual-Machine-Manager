import type { Dispatch, ReactNode, SetStateAction } from 'react'
import type { VmConfig } from '@shared/config'
import type { HostInfo } from '@shared/ipc'
import { fileName, gb } from '../util'
import PortForwards from './PortForwards'

interface Props {
  form: VmConfig
  setForm: Dispatch<SetStateAction<VmConfig>>
  host: HostInfo | null
  locked: boolean
  isDraft: boolean
  dirty: boolean
  nameError: string | null
  diskError: string | null
  /** a port forward row has an error, Save stays off until it's fixed */
  forwardsInvalid: boolean
  onSave: () => void
  onRevert: () => void
  onDelete: () => void
}

export default function Hardware({ form, setForm, host, locked, isDraft, dirty, nameError, diskError, forwardsInvalid, onSave, onRevert, onDelete }: Props) {
  const set = <K extends keyof VmConfig>(k: K, v: VmConfig[K]) => setForm((f) => ({ ...f, [k]: v }))
  const maxRam = host ? Math.max(1024, Math.floor((host.totalRamMB - 2048) / 512) * 512) : 32768
  const maxCpu = host?.cpuCount ?? 16

  return (
    <div className="hardware">
      {locked && <div className="notice">Power off the VM to change its hardware.</div>}
      <fieldset disabled={locked}>
        <Group title="General">
          <Row label="Name" error={nameError}>
            <input value={form.name} onChange={(e) => set('name', e.target.value)} />
          </Row>
          <Row label="Guest OS">
            <select value={form.os} onChange={(e) => set('os', e.target.value as VmConfig['os'])}>
              <option value="linux">Linux</option>
              <option value="windows">Windows</option>
              <option value="other">Other</option>
            </select>
          </Row>
        </Group>

        <Group title="Processors and memory">
          <Row label="Processor cores" hint={`of ${maxCpu} on this PC`}>
            <div className="slider">
              <input type="range" min={1} max={maxCpu} value={form.cpus} onChange={(e) => set('cpus', Number(e.target.value))} />
              <output>{form.cpus}</output>
            </div>
          </Row>
          <Row label="Memory" hint="leave a few GB for Windows">
            <div className="slider">
              <input type="range" min={512} max={maxRam} step={512} value={form.ramMB} onChange={(e) => set('ramMB', Number(e.target.value))} />
              <output>{gb(form.ramMB)}</output>
            </div>
          </Row>
        </Group>

        <Group title="Storage">
          <Row label="Disk size" error={diskError} hint={isDraft ? 'grows as the guest writes, up to this size' : 'only used when the disk file is created'}>
            <div className="with-unit">
              <input
                type="number"
                min={5}
                max={4096}
                aria-invalid={Boolean(diskError)}
                value={Number.isNaN(form.diskSizeGB) ? '' : form.diskSizeGB}
                onChange={(e) => set('diskSizeGB', e.target.value === '' ? Number.NaN : Number(e.target.value))}
              />
              <span>GB</span>
            </div>
          </Row>
          <Row label="Disk controller" hint="VirtIO is fastest. Keep IDE for a guest that was installed on IDE.">
            <select value={form.diskBus} onChange={(e) => set('diskBus', e.target.value as VmConfig['diskBus'])}>
              <option value="virtio">VirtIO</option>
              <option value="sata">SATA</option>
              <option value="ide">IDE</option>
            </select>
          </Row>
          <Row label="CD/DVD">
            <select value={form.iso} onChange={(e) => set('iso', e.target.value)}>
              <option value="">Empty</option>
              {host?.isos.map((iso) => (
                <option key={iso} value={iso}>
                  {fileName(iso)}
                </option>
              ))}
              {form.iso && host && !host.isos.includes(form.iso) && <option value={form.iso}>{fileName(form.iso)} (missing)</option>}
            </select>
          </Row>
          <Row label="">
            <label className="check">
              <input type="checkbox" checked={form.bootFromIso} onChange={(e) => set('bootFromIso', e.target.checked)} />
              Boot from CD/DVD first
            </label>
          </Row>
        </Group>

        <Group title="Display and network">
          <Row label="Graphics adapter">
            <select value={form.video} onChange={(e) => set('video', e.target.value as VmConfig['video'])}>
              <option value="qxl">QXL</option>
              <option value="virtio">VirtIO GPU (OpenGL)</option>
              <option value="std">Standard VGA</option>
              <option value="vmware">VMware SVGA</option>
            </select>
          </Row>
          <Row label="Window backend">
            <select value={form.display} onChange={(e) => set('display', e.target.value as VmConfig['display'])}>
              <option value="auto">Automatic (SDL)</option>
              <option value="sdl">SDL</option>
              <option value="gtk">GTK</option>
              <option value="none">None (headless)</option>
            </select>
          </Row>
          <Row label="Network">
            <select value={form.network} onChange={(e) => set('network', e.target.value as VmConfig['network'])}>
              <option value="nat">NAT</option>
              <option value="none">Disconnected</option>
            </select>
          </Row>
          <Row label="Network adapter">
            <select value={form.nic} onChange={(e) => set('nic', e.target.value as VmConfig['nic'])}>
              <option value="virtio-net-pci">VirtIO</option>
              <option value="e1000">Intel E1000</option>
              <option value="rtl8139">Realtek RTL8139</option>
            </select>
          </Row>
        </Group>

        <Group title="Port forwarding">
          <Row
            label="Forwards"
            hint={form.network === 'nat' ? 'Reach a service in the guest from this PC, for example ssh -p 2222 user@127.0.0.1' : 'Needs NAT networking'}
          >
            <PortForwards forwards={form.forwards} disabled={form.network !== 'nat'} checkPorts={!locked} onChange={(f) => set('forwards', f)} />
          </Row>
        </Group>

        <Group title="Startup">
          <Row label="When the app opens">
            <label className="check">
              <input type="checkbox" checked={form.autostart} onChange={(e) => set('autostart', e.target.checked)} />
              Start this VM automatically
            </label>
            <label className="check">
              <input type="checkbox" checked={form.resumeLast} disabled={!form.autostart} onChange={(e) => set('resumeLast', e.target.checked)} />
              Resume its saved state if it has one
            </label>
          </Row>
        </Group>

        <Group title="Advanced">
          <Row label="Firmware">
            <select value={form.firmware} onChange={(e) => set('firmware', e.target.value as VmConfig['firmware'])}>
              <option value="bios">BIOS</option>
              <option value="uefi">UEFI</option>
            </select>
          </Row>
          <Row label="Acceleration">
            <select value={form.accel} onChange={(e) => set('accel', e.target.value as VmConfig['accel'])}>
              <option value="auto">Automatic</option>
              <option value="whpx">WHPX</option>
              <option value="tcg">None (TCG)</option>
            </select>
          </Row>
          <Row label="Extra QEMU arguments">
            <input className="mono" value={form.extraArgs} placeholder="-device intel-hda -device hda-duplex" onChange={(e) => set('extraArgs', e.target.value)} />
          </Row>
        </Group>
      </fieldset>

      <div className="form-actions">
        {!isDraft && (
          <button className="btn danger-ghost" disabled={locked} onClick={onDelete}>
            Remove from library
          </button>
        )}
        <span className="spacer" />
        <button className="btn" disabled={!dirty || locked} onClick={onRevert}>
          {isDraft ? 'Cancel' : 'Revert'}
        </button>
        <button className="btn primary" disabled={!dirty || Boolean(nameError) || Boolean(diskError) || forwardsInvalid || locked} onClick={onSave}>
          {isDraft ? 'Create' : 'Save'}
        </button>
      </div>
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="group">
      <h2>{title}</h2>
      {children}
    </section>
  )
}

function Row({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }) {
  return (
    <div className="prop-row">
      <span className="prop-label">{label}</span>
      <div className="prop-control">
        {children}
        {error ? <span className="prop-error">{error}</span> : hint ? <span className="prop-hint">{hint}</span> : null}
      </div>
    </div>
  )
}
