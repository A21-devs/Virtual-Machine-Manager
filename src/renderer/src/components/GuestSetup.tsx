import { useEffect, useState } from 'react'
import type { VmConfig } from '@shared/config'
import Modal from './Modal'

/** Shown when Save state runs on a guest that can't hibernate itself yet. */
export default function GuestSetup({ vm, reason, onClose }: { vm: VmConfig; reason: string; onClose: () => void }) {
  const [cmd, setCmd] = useState('')
  const linux = vm.os === 'linux'
  const nat = vm.network === 'nat'

  useEffect(() => {
    if (linux) window.vmm.guestSetupCommand().then(setCmd, () => setCmd(''))
  }, [linux])

  return (
    <Modal
      title={`Set up Save state in ${vm.name}`}
      onClose={onClose}
      width={560}
      footer={
        <>
          <span className="spacer" />
          <button className="btn primary" onClick={onClose}>
            Got it
          </button>
        </>
      }
    >
      <p>
        Save state asks {vm.name} to hibernate: everything that's open goes to its own disk and the VM turns off. Power on brings it all back. {vm.name} needs a
        one-time setup for that first.
      </p>
      {linux ? (
        <>
          {!nat && (
            <p className="warn-text">
              The setup command downloads a script from this app over the VM's network, and {vm.name} is set to Disconnected. Switch it to NAT on the Hardware tab first.
            </p>
          )}
          <ol className="setup-steps">
            <li>In {vm.name}, open a terminal.</li>
            <li>
              Type this and press Enter (pasting from Windows doesn't work inside the VM):
              <code className="setup-cmd">{cmd || '…'}</code>
            </li>
            <li>Enter your password when it asks, and wait for "Done".</li>
            <li>Restart {vm.name} once. After that, Save state works every time.</li>
          </ol>
          <p className="muted">
            It installs qemu-guest-agent, makes sure the VM has swap at least as big as its memory, and tells the kernel where to resume from. It's written for Debian-based guests
            (Kali, Parrot, Ubuntu). Keep this app open while it runs, the VM downloads the script from it.
          </p>
        </>
      ) : (
        <ol className="setup-steps">
          <li>Install the QEMU guest agent in {vm.name}. It's on the virtio-win ISO, under guest-agent.</li>
          <li>
            In an admin terminal in {vm.name}, turn hibernation on:
            <code className="setup-cmd">powercfg /hibernate on</code>
          </li>
          <li>Try Save state again.</li>
        </ol>
      )}
      <p className="muted">Details: {reason}</p>
    </Modal>
  )
}
