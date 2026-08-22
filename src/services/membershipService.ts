import type { EmailOtpType } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import type { MemberAccessResponse } from '@/types/membership';

const MEMBER_ACCESS_URL = 'https://cttfzgvhiewfckydcrci.supabase.co/functions/v1/member-access';
const DEFAULT_NEXT_PATH = '/member-note';

export function sanitizeMembershipNextPath(value: string | null | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return DEFAULT_NEXT_PATH;
  if (value.startsWith('/auth/')) return DEFAULT_NEXT_PATH;
  return value;
}

export async function requestMembershipLogin(email: string, nextPath?: string | null): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error('請輸入有效的 Email。');
  }

  const callbackUrl = new URL('/auth/callback', window.location.origin);
  callbackUrl.searchParams.set('next', sanitizeMembershipNextPath(nextPath));
  const { error } = await supabase.auth.signInWithOtp({
    email: normalizedEmail,
    options: {
      shouldCreateUser: true,
      emailRedirectTo: callbackUrl.toString(),
    },
  });

  if (error) throw new Error(error.message || '登入信寄送失敗，請稍後重試。');
}

export async function completeMembershipCallback(currentUrl: string): Promise<string> {
  const url = new URL(currentUrl);
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const accessToken = hash.get('access_token');
  const refreshToken = hash.get('refresh_token');
  const initialSession = await supabase.auth.getSession();

  if (!initialSession.data.session && code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) throw new Error('登入連結已失效，請重新寄送登入信。');
  } else if (!initialSession.data.session && tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    if (error) throw new Error('登入連結已失效，請重新寄送登入信。');
  } else if (!initialSession.data.session && accessToken && refreshToken) {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    if (error) throw new Error('登入連結已失效，請重新寄送登入信。');
  }

  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session) throw new Error('找不到有效登入憑證，請重新寄送登入信。');

  await fetchMemberAccess('activate');
  return sanitizeMembershipNextPath(url.searchParams.get('next'));
}

export async function fetchMemberAccess(action: 'activate' | 'status' = 'status'): Promise<MemberAccessResponse> {
  const { data, error } = await supabase.auth.getSession();
  if (error || !data.session?.access_token) throw new Error('AUTH_REQUIRED');

  const response = await fetch(MEMBER_ACCESS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${data.session.access_token}`,
    },
    body: JSON.stringify({ action }),
  });
  const json = await response.json().catch(() => null) as MemberAccessResponse | null;
  if (!response.ok || !json?.success) {
    throw new Error(json?.error || `MEMBER_ACCESS_FAILED_${response.status}`);
  }
  return json;
}

export async function signOutMembership(): Promise<void> {
  const { error } = await supabase.auth.signOut();
  if (error) throw new Error(error.message || '登出失敗，請稍後重試。');
}
