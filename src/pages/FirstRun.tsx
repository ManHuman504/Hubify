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
  { id: 'winget',  label: 'Package manager (winget)' },
  { id: 'sources', label: 'Package sources' },
  { id: 'scan',    label: 'Scanning installed apps' },
]

interface Props {
  onComplete: () => void
}

export default function FirstRun({ onComplete }: Props) {
  const [guardianEnabled, setGuardianEnabled] = useState(true)
  const [phase, setPhase] = useState<'onboard1' | 'onboard2' | 'done'>('onboard1')
  const [setupSteps, setSetupSteps] = useState<StepState[]>(
    SETUP_STEPS.map(s => ({ ...s, status: 'pending', message: '' }))
  )
  const [setupPercent, setSetupPercent] = useState(0)
  const [setupError, setSetupError] = useState<string | null>(null)
  const [setupComplete, setSetupComplete] = useState(false)
  const unlistenRef = useRef<(() => void) | null>(null)

  const updateStep = (id: string, status: StepState['status'], message: string) => {
    setSetupSteps(prev => prev.map(s => s.id === id ? { ...s, status, message } : s))
  }

  const runSetup = async () => {
    const unlisten = await listen<SetupProgress>('setup_progress', (event) => {
      const { step, status, message, percent: p } = event.payload
      setSetupPercent(p)
      if (step === 'done') return
      updateStep(step, status as StepState['status'], message)
    })
    unlistenRef.current = unlisten

    try {
      await invoke('run_first_setup')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setSetupError(msg)
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

  // ── Onboarding page 1: Tray + setup ────────────────────────────
  if (phase === 'onboard1') {
    return (
      <div className="fr-root">
        <div className="fr-card">
          <div className="fr-logo">
            <span className="fr-logo-mark">H</span>
          </div>
          <h1 className="fr-title">Welcome to Hubify</h1>

          <div className="fr-media">
            <div className="fr-gif-placeholder">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="fr-gif-icon">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z"/>
                <path d="M12 8v4l3 3"/>
                <path d="M8 12h8"/>
              </svg>
              <span className="fr-gif-label">preview</span>
            </div>
          </div>

          <p className="fr-subtitle">
            Hubify lives in your system tray — click to access all saved programs
            instantly, no digging through the Start menu.
          </p>
          <p className="fr-subtitle">
            Drag the Hubify icon from the tray onto your taskbar to pin it
            for one-click access.
          </p>

          <div className="fr-divider" />

          <div className="fr-setup-block">
            <div className="fr-progress-track">
              <div className="fr-progress-fill" style={{ width: `${setupPercent}%` }} />
            </div>
            <div className="fr-steps">
              {setupSteps.map(step => (
                <div key={step.id} className={`fr-step fr-step-${step.status}`}>
                  <span className="fr-step-icon">
                    {step.status === 'pending' && <span className="fr-dot" />}
                    {step.status === 'running' && <span className="fr-spinner" />}
                    {step.status === 'ok'      && '✓'}
                    {step.status === 'error'   && '✕'}
                    {step.status === 'skip'    && '–'}
                  </span>
                  <div className="fr-step-info">
                    <p className="fr-step-label">{step.label}</p>
                    {step.message && <p className="fr-step-msg">{step.message}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="fr-guardian-toggle">
            <p className="fr-guardian-label">🛡️ Guardian Mode</p>
            <p className="fr-guardian-desc">
              Monitor startup registry and get notified when new programs add themselves to autostart?
            </p>
            <div className="fr-guardian-btns">
              <button
                className={`fr-guardian-btn ${!guardianEnabled ? 'active' : ''}`}
                onClick={() => setGuardianEnabled(false)}
                disabled={!setupComplete}
              >No, thanks</button>
              <button
                className={`fr-guardian-btn ${guardianEnabled ? 'active' : ''}`}
                onClick={() => setGuardianEnabled(true)}
                disabled={!setupComplete}
              >Yes, enable</button>
            </div>
          </div>

          {setupComplete ? (
            <button
              className="fr-btn-start"
              onClick={() => setPhase('onboard2')}
            >
              Next →
            </button>
          ) : (
            <div className="fr-setup-hint">
              {setupError
                ? <span className="fr-error-text">Setup had issues</span>
                : <span className="fr-spinner" style={{ display: 'inline-block' }} />
              }
            </div>
          )}

          {!setupComplete && (
            <button
              className="fr-btn-skip"
              onClick={() => {
                invoke('set_guardian_enabled', { enabled: guardianEnabled }).catch(() => {})
                invoke('mark_setup_complete').catch(() => {})
                setPhase('onboard2')
              }}
            >
              Skip setup
            </button>
          )}
        </div>
      </div>
    )
  }

  // ── Onboarding page 2: Process tree ───────────────────────────
  if (phase === 'onboard2') {
    return (
      <div className="fr-root">
        <div className="fr-card">
          <div className="fr-logo">
            <span className="fr-logo-mark">H</span>
          </div>
          <h1 className="fr-title">Everything in One Tree</h1>

          <div className="fr-media">
            <div className="fr-gif-placeholder">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="fr-gif-icon">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <circle cx="12" cy="8" r="2"/>
                <circle cx="8" cy="16" r="2"/>
                <circle cx="16" cy="16" r="2"/>
                <line x1="12" x2="8" y1="10" y2="14"/>
                <line x1="12" x2="16" y1="10" y2="14"/>
              </svg>
              <span className="fr-gif-label">preview</span>
            </div>
          </div>

          <p className="fr-subtitle">
            Create shortcuts for your favourite apps, and Hubify automatically
            organises all running processes into a single expandable tree —
            no more hunting through Task Manager.
          </p>

          <button
            className="fr-btn-start"
            onClick={() => {
              invoke('set_guardian_enabled', { enabled: guardianEnabled }).catch(() => {})
              invoke('mark_setup_complete').catch(() => {})
              onComplete()
            }}
          >
            Finish →
          </button>
        </div>
      </div>
    )
  }

  // ── Done (fallback) ─────────────────────────────────────────────
  return (
    <div className="fr-root">
      <div className="fr-card">
        <div className="fr-logo">
          <span className="fr-logo-mark">H</span>
        </div>
        <div className="fr-done-icon">✓</div>
        <h1 className="fr-title">You're all set</h1>
        <p className="fr-subtitle">Hubify is ready. Enjoy!</p>
        <button className="fr-btn-start" onClick={onComplete}>Open Hubify →</button>
      </div>
    </div>
  )
}