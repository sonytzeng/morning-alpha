type RecommendationDecisionCopyInput = {
  trigger: unknown;
  industry: unknown;
  name: unknown;
  invalidation: unknown;
};

type NoTradeDecisionCopyInput = {
  sourceDetail: unknown;
  industry: unknown;
  name: unknown;
  stopCondition: unknown;
};

export type DecisionSentenceCopy = {
  sentence: string;
  subscriber_sentence: string;
};

function compactLabel(value: unknown, fallback: string): string {
  const normalized = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[。；;，,]+$/u, '');
  return normalized || fallback;
}

export function normalizeDecisionCondition(value: unknown, fallback: string): string {
  const normalized = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(?:(?:若|如果|一旦)\s*)+/u, '')
    .replace(/[。；;]+$/u, '');
  if (!normalized) return fallback;

  const firstClause = normalized
    .split(/[，；;]/u)
    .map((part) => part.trim())
    .find(Boolean) || normalized;

  return firstClause
    .replace(/(?:今日)?(?:受惠|觀察|偏多|偏空)?(?:判斷|假設|主線)?(?:即|將|就)?失效$/u, '')
    .trim() || fallback;
}

export function buildRecommendationDecisionCopy(
  input: RecommendationDecisionCopyInput,
): DecisionSentenceCopy {
  const trigger = compactLabel(input.trigger, '隔夜市場訊號');
  const industry = compactLabel(input.industry, '主要族群');
  const name = compactLabel(input.name, '代表股');
  const condition = normalizeDecisionCondition(
    input.invalidation,
    `${name}弱於大盤或${industry}沒有量價同步`,
  );

  return {
    sentence: `${trigger}先傳導至${industry}；09:30 看${name}是否相對大盤轉強；若${condition}，今日不追價並撤回受惠假設。`,
    subscriber_sentence: `今天不是看到題材就追；09:30 先確認${industry}與${name}同步轉強；若${condition}，今日不追價並撤回主線。`,
  };
}

export function buildNoTradeDecisionCopy(
  input: NoTradeDecisionCopyInput,
): DecisionSentenceCopy {
  const sourceDetail = compactLabel(input.sourceDetail, '隔夜市場訊號');
  const industry = compactLabel(input.industry, '主要族群');
  const name = compactLabel(input.name, '代表股');
  const condition = normalizeDecisionCondition(
    input.stopCondition,
    `${name}與${industry}未同步止跌`,
  );

  return {
    sentence: `${sourceDetail}未形成正向主線；09:30 看${name}與${industry}是否同步止跌；若${condition}，今日不建立受惠股。`,
    subscriber_sentence: `今天不硬猜強勢股；09:30 先用${name}與${industry}同步性驗證；若${condition}，整日不建立受惠股。`,
  };
}
