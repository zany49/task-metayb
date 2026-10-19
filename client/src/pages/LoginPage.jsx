import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useRequestOtp, useVerifyOtp } from '../api/queries.js';
import { homePathFor, useAuth } from '../auth/AuthContext.jsx';
import { Wordmark } from '../components/AppShell.jsx';
import Field from '../components/Field.jsx';
import { FormError } from '../components/States.jsx';
import { formatMobile } from '../lib/format.js';

/** Seeded demo accounts (npm run seed). Shown so a reviewer can sign in without looking them up. */
const DEMO_ACCOUNTS = [
  { name: 'Priya Raman', role: 'Dispatcher', mobile: '9000000001' },
  { name: 'Arjun Mehta', role: 'Dispatcher', mobile: '9000000002' },
  { name: 'Ravi Kumar', role: 'Rider', mobile: '9100000001' },
  { name: 'Karthik Srinivasan', role: 'Rider', mobile: '9100000002' },
  { name: 'Deepa Rajan', role: 'Rider', mobile: '9100000008' },
];

/** Errors after which the code has to be requested again. */
const NEEDS_NEW_CODE = new Set(['OTP_EXPIRED', 'OTP_ATTEMPTS_EXCEEDED']);

export default function LoginPage() {
  const { signIn, notice } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [step, setStep] = useState('mobile');
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  const [hint, setHint] = useState(null);

  const requestOtp = useRequestOtp();
  const verifyOtp = useVerifyOtp();
  const otpRef = useRef(null);

  useEffect(() => {
    if (step === 'otp') otpRef.current?.focus();
  }, [step]);

  function sendCode(number = mobile) {
    verifyOtp.reset();
    requestOtp.mutate(number, {
      onSuccess: (result) => {
        setHint(result.demoHint ?? null);
        setOtp('');
        setStep('otp');
      },
    });
  }

  function pickDemoAccount(account) {
    setMobile(account.mobile);
    sendCode(account.mobile);
  }

  function verify(event) {
    event.preventDefault();
    verifyOtp.mutate(
      { mobile, otp },
      {
        onSuccess: (session) => {
          signIn({ token: session.token, user: session.user });
          navigate(location.state?.from ?? homePathFor(session.user), { replace: true });
        },
      },
    );
  }

  const otpError = verifyOtp.error;
  const mustResend = otpError && NEEDS_NEW_CODE.has(otpError.code);

  return (
    <div className="login">
      <section className="login__brand">
        <Wordmark inverted />
        <div className="login__intro">
          <h1 className="login__headline">Dispatch desk</h1>
          <p className="login__lede">Assign riders, follow every delivery, and catch jobs that stall before customers notice.</p>
        </div>
        <svg className="login__route" viewBox="0 0 320 60" aria-hidden="true">
          <path d="M8 30h304" className="login__route-line" />
          <path d="M120 30c20 0 20 22 44 22h60" className="login__route-branch" />
          {[8, 64, 120, 176, 232, 312].map((x, i) => (
            <circle key={x} cx={x} cy="30" r="7" className={i === 3 ? 'login__route-stop login__route-stop--here' : 'login__route-stop'} />
          ))}
          <circle cx="224" cy="52" r="5" className="login__route-stop login__route-stop--side" />
        </svg>
      </section>

      <section className="login__panel">
        <div className="login__card">
          {notice && (
            <div className="notice" role="status">
              {notice}
            </div>
          )}

          {step === 'mobile' ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                sendCode();
              }}
              noValidate
            >
              <h2 className="login__title">Sign in</h2>
              <p className="login__text">Enter your mobile number. We will send you a one-time code.</p>
              <Field label="Mobile number" error={requestOtp.error?.code === 'VALIDATION_ERROR' ? requestOtp.error.details?.[0]?.message : null}>
                {(props) => (
                  <input
                    {...props}
                    className="input input--large"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="98765 43210"
                    value={mobile}
                    onChange={(e) => setMobile(e.target.value)}
                    autoFocus
                  />
                )}
              </Field>
              {requestOtp.error?.code !== 'VALIDATION_ERROR' && <FormError error={requestOtp.error} />}
              <button type="submit" className="button button--primary button--block" disabled={requestOtp.isPending || !mobile.trim()}>
                {requestOtp.isPending ? 'Sending code…' : 'Send code'}
              </button>
            </form>
          ) : (
            <form onSubmit={verify} noValidate>
              <h2 className="login__title">Enter your code</h2>
              <p className="login__text">
                We sent a code to <strong>{formatMobile(mobile.replace(/\D/g, '').slice(-10))}</strong>.{' '}
                <button type="button" className="link-button" onClick={() => setStep('mobile')}>
                  Use a different number
                </button>
              </p>
              <Field label="One-time code" hint={hint} error={otpError && !mustResend ? otpError.message : null}>
                {(props) => (
                  <input
                    {...props}
                    ref={otpRef}
                    className="input input--large input--code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                  />
                )}
              </Field>
              {mustResend && (
                <FormError>
                  {otpError.message}{' '}
                  <button type="button" className="link-button" onClick={() => sendCode()}>
                    Send a new code
                  </button>
                </FormError>
              )}
              <button type="submit" className="button button--primary button--block" disabled={verifyOtp.isPending || otp.length < 4}>
                {verifyOtp.isPending ? 'Signing in…' : 'Sign in'}
              </button>
              <button type="button" className="link-button login__resend" onClick={() => sendCode()} disabled={requestOtp.isPending}>
                Send the code again
              </button>
            </form>
          )}
        </div>

        <details className="demo">
          <summary className="demo__summary">Demo accounts</summary>
          <p className="demo__text">Pick an account to fill in its number and send the code. The code is 1234.</p>
          <ul className="demo__list">
            {DEMO_ACCOUNTS.map((account) => (
              <li key={account.mobile}>
                <button type="button" className="demo__account" onClick={() => pickDemoAccount(account)}>
                  <span className="demo__name">{account.name}</span>
                  <span className="demo__meta">
                    {account.role}, {formatMobile(account.mobile)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      </section>
    </div>
  );
}
