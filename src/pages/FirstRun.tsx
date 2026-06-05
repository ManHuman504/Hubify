import { useState, useEffect, useRef } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import './FirstRun.css'

interface SetupProgress {
  step: string
  status: 'running' | 'ok' | 'error' | 'skip'
  message: string
  percent: number
}

interface StepState {
  id: string
  label: string
  status: 'pending' | 'running' | 'ok' | 'error' | 'skip'
  message: string
}

const SETUP_STEPS: { id: string; label: string }[] = [
  { id: 'winget',  label: 'Package Manager (winget)' },
  { id: 'sources', label: 'Updating Sources' },
  { id: 'scan',    label: 'Scanning for Apps' },
]

interface Props {
  onComplete: () => void
}

function StepIcon({ status }: { status: StepState['status'] }) {
  switch (status) {
    case 'ok':
      return <span className="fr-step-icon">&#x2713;</span>
    case 'running':
      return <span className="fr-step-icon">&#x21bb;</span>
    case 'error':
      return <span className="fr-step-icon">&#x2717;</span>
    case 'skip':
      return <span className="fr-step-icon" style={{ color: '#555' }}>&ndash;</span>
    default:
      return <span className="fr-step-icon" style={{ color: '#555' }}>&#x25CB;</span>
  }
}

export default function FirstRun({ onComplete }: Props) {
  const [phase, setPhase] = useState<'welcome' | 'tray' | 'guard'>('welcome')
  const [setupSteps, setSetupSteps] = useState<StepState[]>(
    SETUP_STEPS.map(s => ({ ...s, status: 'pending', message: '' }))
  )
  const [setupPercent, setSetupPercent] = useState(0)
  const [setupComplete, setSetupComplete] = useState(false)
  const unlistenRef = useRef<(() => void) | null>(null)

  const updateStep = (id: string, status: StepState['status'], message: string) => {
    setSetupSteps(prev => prev.map(s => s.id === id ? { ...s, status, message } : s))
  }

  const runSetup = async () => {
    const unlisten = await listen<SetupProgress>('setup_progress', (event) => {
      const { step, status, message, percent: p } = event.payload
      setSetupPercent(p)
      if (step === 'done') {
        setSetupComplete(true)
        return
      }
      updateStep(step, status as StepState['status'], message)
    })
    unlistenRef.current = unlisten

    try {
      await invoke('run_first_setup')
    } catch (_e: unknown) {
      // Setup error handled silently
    }

    if (unlistenRef.current) {
      unlistenRef.current()
      unlistenRef.current = null
    }

    setSetupSteps(prev => prev.map(s =>
      s.status === 'pending' || s.status === 'running'
        ? { ...s, status: 'ok', message: '' }
        : s
    ))
    setSetupPercent(100)
    setSetupComplete(true)
  }

  useEffect(() => {
    runSetup()
    return () => { unlistenRef.current?.() }
  }, [])

  // ── Page 1: Welcome + Setup ──────────────────────────────
  if (phase === 'welcome') {
    return (
      <div className="fr-root">
        <div className="fr-card">
          <div className="fr-logo">
            <img src="/Hubify.svg" alt="Hubify" className="fr-logo-img" />
          </div>
          <h1 className="fr-title">Welcome to Hubify</h1>

          <div className="fr-setup">
            <div className="fr-progress">
              <div className="fr-bar" style={{ width: `${setupPercent}%` }} />
            </div>
            <div className="fr-steps">
              {setupSteps.map(step => (
                <div key={step.id} className={`fr-step fr-step-${step.status}`}>
                  <StepIcon status={step.status} />
                  <span className="fr-step-label">{step.label}</span>
                  {step.message && <span className="fr-step-msg">{step.message}</span>}
                </div>
              ))}
            </div>
          </div>

          {setupComplete ? (
            <button className="fr-btn" onClick={() => setPhase('tray')}>
              Next →
            </button>
          ) : (
            <div className="fr-spinner" />
          )}
        </div>
      </div>
    )
  }

  // ── Page 2: Tray Info ────────────────────────────────────
  if (phase === 'tray') {
    return (
      <div className="fr-root">
        <div className="fr-card">
          <div className="fr-logo">
            <img src="/Hubify.svg" alt="Hubify" className="fr-logo-img" />
          </div>
          <h1 className="fr-title">Quick Tray Access</h1>

          <div className="fr-gif">
            <img src="/tray.gif" alt="Tray preview" className="fr-gif-img" />
          </div>

          <p className="fr-desc">
            Hubify lives in your system tray. Click to open saved programs instantly.
            Drag the icon to your taskbar to pin it.
          </p>

          <button className="fr-btn" onClick={() => setPhase('guard')}>
            Next →
          </button>
        </div>
      </div>
    )
  }

  // ── Page 3: Guard Startup ──────────────────────────────────
  return (
    <div className="fr-root">
      <div className="fr-card">
        <div className="fr-logo">
          <img src="/Hubify.svg" alt="Hubify" className="fr-logo-img" />
        </div>
        <h1 className="fr-title">Guard Startup</h1>

        <div className="fr-gif">
          <img src="/guard.gif" alt="Guard preview" className="fr-gif-img" />
        </div>

        <p className="fr-desc">
          Hubify can monitor and protect your startup programs.
          You will be notified whenever an app adds itself to autostart,
          keeping unwanted programs out.
        </p>

        <div className="fr-guard-btns">
          <button className="fr-btn fr-btn-allow" onClick={async () => {
            await invoke('set_guardian_enabled', { enabled: true })
            onComplete()
          }}>
            Allow ✓
          </button>
          <button className="fr-btn fr-btn-deny" onClick={async () => {
            await invoke('set_guardian_enabled', { enabled: false })
            onComplete()
          }}>
            Deny
          </button>
        </div>
      </div>
    </div>
  )
}
