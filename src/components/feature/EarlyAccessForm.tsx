import { useState } from 'react';
import { submitEarlyAccess, trackEngagementEvent } from '@/services/engagementService';

interface EarlyAccessFormProps {
  sourcePage: string;
  className?: string;
}

export default function EarlyAccessForm({ sourcePage, className = '' }: EarlyAccessFormProps) {
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    setSubmitting(true);
    const result = await submitEarlyAccess({
      email: email.trim(),
      source_page: sourcePage,
      interests: ['paid_membership'],
    });
    setSubmitting(false);
    if (!result.success) {
      setError(result.error || '目前無法送出，請稍後再試。');
      return;
    }
    setSubmitted(true);
    void trackEngagementEvent('submit_early_access', {
      page_path: sourcePage,
      content_type: 'paid_membership',
    });
  };

  if (submitted) {
    return (
      <div className={`ma-early-access-form is-success ${className}`} role="status">
        <i className="ri-check-line" aria-hidden="true" />
        <div>
          <strong>已加入早鳥名單</strong>
          <p>正式收費前會先通知方案、價格與開放日期；登記不等於購買。</p>
        </div>
      </div>
    );
  }

  return (
    <form className={`ma-early-access-form ${className}`} onSubmit={handleSubmit} noValidate>
      <label htmlFor={`early-access-email-${sourcePage.replace(/\W/g, '-')}`}>Email</label>
      <div className="ma-early-access-form-row">
        <input
          id={`early-access-email-${sourcePage.replace(/\W/g, '-')}`}
          type="email"
          name="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          required
          aria-describedby={error ? `early-access-error-${sourcePage.replace(/\W/g, '-')}` : undefined}
          aria-invalid={Boolean(error)}
        />
        <button type="submit" disabled={submitting}>
          {submitting ? '送出中...' : '加入早鳥名單'}
        </button>
      </div>
      {error && <p id={`early-access-error-${sourcePage.replace(/\W/g, '-')}`} className="is-error" role="alert">{error}</p>}
      <p>只用於會員方案與重要更新通知，不會直接扣款。</p>
    </form>
  );
}
