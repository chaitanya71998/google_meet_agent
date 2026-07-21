'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
      }
      router.replace('/');
    } catch (e: any) {
      setError(e.message || 'Auth failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center">
      <form className="auth-card" onSubmit={onSubmit}>
        <h1>Google Meet Agent</h1>
        <p>{mode === 'login' ? 'Sign in to your account' : 'Create an account'}</p>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
        </label>
        {error && <div className="form-error">{error}</div>}
        <button className="primary-btn full" disabled={busy} type="submit">
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Sign up'}
        </button>
        <p style={{ marginTop: 14, textAlign: 'center' }}>
          {mode === 'login' ? (
            <a onClick={() => setMode('signup')}>Need an account? Sign up</a>
          ) : (
            <a onClick={() => setMode('login')}>Have an account? Sign in</a>
          )}
        </p>
      </form>
    </div>
  );
}
