import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// LINE Webhook Handler v2 — 處理 follow/unfollow/message，寫入 line_subscribers
Deno.serve(async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-line-signature',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const channelSecret = Deno.env.get('LINE_CHANNEL_SECRET');
  const channelAccessToken = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN');

  if (!channelSecret || !channelAccessToken) {
    console.error('Missing LINE_CHANNEL_SECRET or LINE_CHANNEL_ACCESS_TOKEN');
    return new Response(
      JSON.stringify({ error: 'LINE credentials not configured' }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }

  // 1. 驗證 Webhook 簽名
  const signature = req.headers.get('x-line-signature') || '';
  const body = await req.text();

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(channelSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const computed = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
  const computedBase64 = btoa(String.fromCharCode(...new Uint8Array(computed)));

  if (computedBase64 !== signature) {
    console.error('Invalid LINE signature');
    return new Response(JSON.stringify({ error: 'Invalid signature' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const events = JSON.parse(body).events || [];

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') || '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  );

  for (const event of events) {
    const userId = event.source?.userId;
    if (!userId) continue;

    if (event.type === 'follow') {
      // 取得 profile
      let profile = { displayName: '', pictureUrl: '', statusMessage: '' };
      try {
        const res = await fetch(`https://api.line.me/v2/bot/profile/${userId}`, {
          headers: { Authorization: `Bearer ${channelAccessToken}` },
        });
        if (res.ok) {
          profile = await res.json();
        }
      } catch (e) {
        console.error('Profile fetch error:', e);
      }

      const { error } = await supabase
        .from('line_subscribers')
        .upsert(
          {
            line_user_id: userId,
            display_name: profile.displayName || null,
            picture_url: profile.pictureUrl || null,
            status_message: profile.statusMessage || null,
            source: 'line_follow',
            is_active: true,
            last_followed_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'line_user_id' },
        );

      if (error) {
        console.error('LINE follow upsert error:', error);
      }
    } else if (event.type === 'unfollow') {
      const { error } = await supabase
        .from('line_subscribers')
        .update({
          is_active: false,
          last_unfollowed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('line_user_id', userId);

      if (error) {
        console.error('LINE unfollow update error:', error);
      }
    } else if (event.type === 'message' && event.message?.type === 'text') {
      const text = event.message.text;
      const replyToken = event.replyToken;

      if (text.includes('訂閱') || text.includes('推播') || text.includes('開始') || text.includes('hello') || text.includes('你好')) {
        await sendReplyMessage(replyToken, '早安，這裡是 Morning Alpha。每天 07:30 我會提醒你今日市場情緒與今天最不該犯的錯。');
      } else if (text.includes('取消') || text.includes('停止') || text.includes('unsubscribe')) {
        await supabase
          .from('line_subscribers')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('line_user_id', userId);
        await sendReplyMessage(replyToken, '已停止每日推播。輸入「訂閱」可重新開始。');
      } else if (text.includes('報告') || text.includes('今日') || text.includes('今天')) {
        const baseUrl = Deno.env.get('SITE_URL') || 'https://morningalphatw.com';
        await sendReplyMessage(replyToken, `查看今日完整策略：${baseUrl}/report/today`);
      } else {
        await sendReplyMessage(replyToken, '早安，這裡是 Morning Alpha。每天 07:30 我會提醒你今日市場情緒與今天最不該犯的錯。輸入「報告」可取得今日連結。');
      }
    }
  }

  return new Response(JSON.stringify({ success: true }), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
});

async function sendReplyMessage(replyToken: string, text: string) {
  const channelAccessToken = Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN');
  if (!channelAccessToken) return;

  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${channelAccessToken}`,
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: 'text', text }],
    }),
  });
}
