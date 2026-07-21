'use client';

import { ReactNode } from 'react';
import { useAuth } from './AuthProvider';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace('/login');
  }, [loading, user, router]);

  if (loading) return <div className="center">Loading…</div>;
  if (!user) return <div className="center">Redirecting to login…</div>;
  return <>{children}</>;
}
