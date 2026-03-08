import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import '../styles/LoginPage.css';

const TABS = ['Email OTP', 'Mobile OTP'];

export default function LoginPage() {
    const { signInWithEmail, signInWithPhone, verifyOtp } = useAuth();
    const navigate = useNavigate();

    const [activeTab, setActiveTab] = useState(0);
    const [step, setStep] = useState(1); // 1 = enter credential, 2 = enter OTP
    const [credential, setCredential] = useState('');
    const [otp, setOtp] = useState(['', '', '', '', '', '']);
    const [loading, setLoading] = useState(false);
    const [smsError, setSmsError] = useState(null); // phone-provider error

    const type = activeTab === 0 ? 'email' : 'phone';

    // ── Send OTP ────────────────────────────────────────────────────────────────
    async function handleSendOtp(e) {
        e.preventDefault();
        if (!credential.trim()) return;
        setSmsError(null);
        setLoading(true);
        try {
            if (type === 'email') {
                await signInWithEmail(credential.trim());
            } else {
                await signInWithPhone(credential.trim());
            }
            toast.success('OTP sent! Check your ' + (type === 'email' ? 'inbox' : 'messages'));
            setStep(2);
        } catch (err) {
            const msg = err.message || '';
            // Detect Supabase phone-provider-not-configured errors
            if (
                type === 'phone' &&
                (msg.toLowerCase().includes('phone') ||
                    msg.toLowerCase().includes('sms') ||
                    msg.toLowerCase().includes('provider') ||
                    msg.toLowerCase().includes('twilio') ||
                    msg.toLowerCase().includes('not enabled') ||
                    err.status === 422)
            ) {
                setSmsError(
                    'SMS provider not configured. Enable Twilio in your Supabase dashboard (Auth → Providers → Phone) to receive codes.'
                );
            } else {
                toast.error(msg || 'Failed to send OTP');
            }
        } finally {
            setLoading(false);
        }
    }

    // ── Verify OTP ──────────────────────────────────────────────────────────────
    async function handleVerifyOtp(e) {
        e.preventDefault();
        const token = otp.join('');
        if (token.length < 6) return;
        setLoading(true);
        try {
            await verifyOtp({ credential: credential.trim(), token, type });
            toast.success('Authenticated!');
            navigate('/upload', { replace: true });
        } catch (err) {
            toast.error(err.message || 'Invalid OTP');
        } finally {
            setLoading(false);
        }
    }

    // ── OTP box key handler ──────────────────────────────────────────────────
    function handleOtpChange(value, idx) {
        if (!/^\d?$/.test(value)) return;
        const next = [...otp];
        next[idx] = value;
        setOtp(next);
        if (value && idx < 5) {
            document.getElementById(`otp-${idx + 1}`)?.focus();
        }
    }

    function handleOtpKeyDown(e, idx) {
        if (e.key === 'Backspace' && !otp[idx] && idx > 0) {
            document.getElementById(`otp-${idx - 1}`)?.focus();
        }
    }

    function handleTabChange(i) {
        setActiveTab(i);
        setStep(1);
        setCredential('');
        setSmsError(null);
        setOtp(['', '', '', '', '', '']);
    }

    return (
        <div className="login-root">
            {/* Background blobs */}
            <div className="blob blob-1" />
            <div className="blob blob-2" />
            <div className="blob blob-3" />

            <div className="login-card">
                {/* Logo / Brand */}
                <div className="login-brand">
                    <div className="login-logo">
                        <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect width="40" height="40" rx="12" fill="url(#grad1)" />
                            <path d="M20 9v22M9 20h22" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" />
                            <defs>
                                <linearGradient id="grad1" x1="0" y1="0" x2="40" y2="40" gradientUnits="userSpaceOnUse">
                                    <stop stopColor="#0ea5e9" />
                                    <stop offset="1" stopColor="#6366f1" />
                                </linearGradient>
                            </defs>
                        </svg>
                    </div>
                    <h1 className="login-title">MedAI Insights</h1>
                    <p className="login-subtitle">Privacy-first clinical intelligence platform</p>
                </div>

                {/* Tab bar */}
                <div className="login-tabs">
                    {TABS.map((tab, i) => (
                        <button
                            key={tab}
                            className={`login-tab ${activeTab === i ? 'active' : ''}`}
                            onClick={() => handleTabChange(i)}
                        >
                            {tab}
                        </button>
                    ))}
                    <div
                        className="login-tab-indicator"
                        style={{ transform: `translateX(${activeTab * 100}%)` }}
                    />
                </div>

                {/* Step 1 — Enter credential */}
                {step === 1 && (
                    <form className="login-form" onSubmit={handleSendOtp}>
                        <div className="input-group">
                            <label>
                                {type === 'email' ? '✉️ Email Address' : '📱 Phone Number'}
                            </label>
                            <input
                                type={type === 'email' ? 'email' : 'tel'}
                                placeholder={type === 'email' ? 'doctor@hospital.org' : '+91 98765 43210'}
                                value={credential}
                                onChange={(e) => setCredential(e.target.value)}
                                required
                                autoFocus
                            />
                        </div>

                        {/* SMS provider warning banner */}
                        {type === 'phone' && smsError && (
                            <div className="sms-warning">
                                <span className="sms-warning-icon">⚠️</span>
                                <div>
                                    <strong>SMS Not Configured</strong>
                                    <p>{smsError}</p>
                                    <a
                                        href="https://supabase.com/dashboard/project/_/auth/providers"
                                        target="_blank"
                                        rel="noreferrer"
                                        className="sms-warning-link"
                                    >
                                        Open Supabase Auth Settings →
                                    </a>
                                </div>
                            </div>
                        )}

                        {/* Inline hint for phone tab even before error */}
                        {type === 'phone' && !smsError && (
                            <p className="sms-hint">
                                📋 Requires Twilio SMS configured in Supabase
                            </p>
                        )}

                        <button type="submit" className="btn-primary" disabled={loading}>
                            {loading ? <span className="btn-spinner" /> : 'Send OTP →'}
                        </button>
                    </form>
                )}

                {/* Step 2 — Enter OTP */}
                {step === 2 && (
                    <form className="login-form" onSubmit={handleVerifyOtp}>
                        <p className="otp-hint">
                            Enter the 6-digit code sent to <strong>{credential}</strong>
                        </p>
                        <div className="otp-inputs">
                            {otp.map((digit, idx) => (
                                <input
                                    key={idx}
                                    id={`otp-${idx}`}
                                    type="text"
                                    inputMode="numeric"
                                    maxLength={1}
                                    value={digit}
                                    onChange={(e) => handleOtpChange(e.target.value, idx)}
                                    onKeyDown={(e) => handleOtpKeyDown(e, idx)}
                                    className="otp-box"
                                    autoFocus={idx === 0}
                                />
                            ))}
                        </div>
                        <button type="submit" className="btn-primary" disabled={loading || otp.join('').length < 6}>
                            {loading ? <span className="btn-spinner" /> : 'Verify & Sign In ✓'}
                        </button>
                        <button type="button" className="btn-ghost" onClick={() => setStep(1)}>
                            ← Back
                        </button>
                    </form>
                )}

                <p className="login-footer">
                    🔒 All patient data stays on your device. Zero-knowledge architecture.
                </p>
            </div>
        </div>
    );
}
