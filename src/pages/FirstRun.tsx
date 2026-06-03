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

const STEPS: { id: string; label: string }[] = [
  { id: 'winget',  label: 'Package manager (winget)' },
  { id: 'sources', label: 'Package sources' },
  { id: 'scan',    label: 'Scanning installed apps' },
  { id: 'done',    label: 'Finishing up' },
]

interface Props {
  onComplete: () => void
}

export default function FirstRun({ onComplete }: Props) {
  const [phase, setPhase] = useState<'intro' | 'setup' | 'done'>('intro')
  const [percent, setPercent] = useState(0)
  const [steps, setSteps] = useState<StepState[]>(
    STEPS.map(s => ({ ...s, status: 'pending', message: '' }))
  )
  const [error, setError] = useState<string | null>(null)
  const unlistenRef = useRef<(() => void) | null>(null)

  const updateStep = (id: string, status: StepState['status'], message: string) => {
    setSteps(prev => prev.map(s => s.id === id ? { ...s, status, message } : s))
  }

  const startSetup = async () => {
    setPhase('setup')
    setError(null)

    // Listen for progress events from Rust
    const unlisten = await listen<SetupProgress>('setup_progress', (event) => {
      const { step, status, message, percent: p } = event.payload
      setPercent(p)

      if (step === 'done') {
        setPhase('done')
        return
      }

      updateStep(step, status as StepState['status'], message)
    })
    unlistenRef.current = unlisten

    try {
      await invoke('run_first_setup')
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(msg)
      setPhase('done')
    } finally {
      unlisten()
      unlistenRef.current = null
    }
  }

  useEffect(() => {
    return () => { unlistenRef.current?.() }
  }, [])

  // ── Intro screen ──────────────────────────────────────────────────────────
  if (phase === 'intro') {
    return (
      <div className="fr-root">
        <div className="fr-card">
          <div className="fr-logo">
            <span className="fr-logo-mark">H</span>
          </div>
          <h1 className="fr-title">Welcome to Hubify</h1>
          <p className="fr-subtitle">
            Let's get you set up. We'll install a few lightweight tools, scan your
            installed apps, and have everything ready in under a minute.
          </p>

          <div className="fr-checklist">
            <div className="fr-check-item">
              <span className="fr-check-icon">📦</span>
              <div>
                <p className="fr-check-label">winget</p>
                <p className="fr-check-desc">Windows package manager for the Store feature</p>
              </div>
            </div>
            <div className="fr-check-item">
              <span className="fr-check-icon">🔍</span>
              <div>
                <p className="fr-check-label">Registry scan</p>
                <p className="fr-check-desc">Finds all installed programs on your PC automatically</p>
              </div>
            </div>
          </div>

          <button className="fr-btn-start" onClick={startSetup}>
            Get started →
          </button>

          <button className="fr-btn-skip" onClick={() => { invoke('mark_setup_complete'); onComplete() }}>
            Skip setup
          </button>
        </div>
      </div>
    )
  }

  // ── Setup in progress ────────────────────────────────────────────────────
  if (phase === 'setup') {
    return (
      <div className="fr-root">
        <div className="fr-card">
          <div className="fr-logo">
            <span className="fr-logo-mark">H</span>
          </div>
          <h1 className="fr-title">Setting up…</h1>

          {/* Progress bar */}
          <div className="fr-progress-track">
            <div className="fr-progress-fill" style={{ width: `${percent}%` }} />
          </div>
          <p className="fr-progress-pct">{percent}%</p>

          {/* Steps list */}
          <div className="fr-steps">
            {steps.map(step => (
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
                  {step.message && (
                    <p className="fr-step-msg">{step.message}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ── Done ─────────────────────────────────────────────────────────────────
  return (
    <div className="fr-root">
      <div className="fr-card">
        <div className="fr-logo">
          <span className="fr-logo-mark">H</span>
        </div>

        {error ? (
          <>
            <h1 className="fr-title">Setup had issues</h1>
            <p className="fr-subtitle fr-error-text">{error}</p>
            <p className="fr-subtitle" style={{ marginTop: 6 }}>
              You can still use Hubify — some features may be limited.
            </p>
          </>
        ) : (
          <>
            <div className="fr-done-icon">✓</div>
            <h1 className="fr-title">You're all set</h1>
            <p className="fr-subtitle">
              Hubify is ready. Your installed apps are available in the Library tab.
            </p>
          </>
        )}

        {/* Summary of steps */}
        <div className="fr-steps fr-steps-compact">
          {steps.map(step => (
            step.status !== 'pending' && (
              <div key={step.id} className={`fr-step fr-step-${step.status}`}>
                <span className="fr-step-icon">
                  {step.status === 'ok'    && '✓'}
                  {step.status === 'error' && '✕'}
                  {step.status === 'skip'  && '–'}
                </span>
                <div className="fr-step-info">
                  <p className="fr-step-label">{step.label}</p>
                  {step.message && <p className="fr-step-msg">{step.message}</p>}
                </div>
              </div>
            )
          ))}
        </div>

        <button className="fr-btn-start" onClick={onComplete}>
          Open Hubify →
        </button>
      </div>
    </div>
  )
}
