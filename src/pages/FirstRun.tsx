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
  { id: 'winget',  label: 'winget' },
  { id: 'sources', label: 'sources' },
  { id: 'scan',    label: 'scan' },
]

interface Props {
  onComplete: () => void
}

export default function FirstRun({ onComplete }: Props) {
  const [phase, setPhase] = useState<'welcome' | 'tray' | 'process'>('welcome')
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
      if (step === 'done') {
        setSetupComplete(true)
        return
      }
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

  // ── Page 1: Welcome + Setup ──────────────────────────────
  if (phase === 'welcome') {
    return (
      <div className="fr-root">
        <div className="fr-card">
          <div className="fr-logo">H</div>
          <h1 className="fr-title">Welcome to Hubify</h1>
          
          <div className="fr-setup">
            <div className="fr-progress">
              <div className="fr-bar" style={{ width: `${setupPercent}%` }} />
            </div>
            <div className="fr-steps">
              {setupSteps.map(step => (
                <div key={step.id} className={`fr-step fr-step-${step.status}`}>
                  <span className="fr-dot" />
                  <span>{step.label}</span>
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
          <div className="fr-logo">H</div>
          <h1 className="fr-title">Quick Tray Access</h1>
          
          <div className="fr-gif">
            <div className="fr-placeholder">tray</div>
          </div>

          <p className="fr-desc">
            Hubify lives in your system tray. Click to open saved programs instantly.
            Drag the icon to your taskbar to pin it.
          </p>

          <button className="fr-btn" onClick={() => setPhase('process')}>
            Next →
          </button>
        </div>
      </div>
    )
  }

  // ── Page 3: Process Tree ─────────────────────────────────
  return (
    <div className="fr-root">
      <div className="fr-card">
        <div className="fr-logo">H</div>
        <h1 className="fr-title">Everything in One Tree</h1>
        
        <div className="fr-gif">
          <div className="fr-placeholder">processes</div>
        </div>

        <p className="fr-desc">
          Create shortcuts for your apps and Hubify will organize all running
          processes into a single tree.
        </p>

        <button className="fr-btn" onClick={onComplete}>
          Finish →
        </button>
      </div>
    </div>
  )
}