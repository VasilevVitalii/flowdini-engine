import type { TFdContent } from 'flowdini-spec';
import { extractLinks, parseAddr, topicAddr } from './addr.js';
import { roleCovers } from './role.js';
import { resolveRole } from './spec.js';
import type { TFdRoleSpec, TFdSpecConfig } from './spec.js';
import { reviewFixIterations, isCrashed } from './state.js';

/** Открытая дуга: топик с `fd-to`, на который ещё никто не ответил (`fd-reply`). */
export interface TFdOpenArc {
  /** Адрес топика-источника, например `REVIEW 1#BUG 1`. */
  addr: string;
  /** `fd-from` источника — кто ждёт ответа. */
  from: string[];
  /** `fd-to` — адресаты, кто должен ответить. */
  to: string[];
}

/** Следующий ход процесса: роли-адресаты + рекомендуемый раздел + дуга. */
export interface TFdNextStep {
  /** Роли, которые должны ответить (адресаты открытой дуги). */
  roles: string[];
  /** Рекомендуемый L1-раздел ответа; `null` — роль решает сама (например `AI.ANALYST`). */
  section: string | null;
  /** Открытая дуга, на которую отвечают. */
  arc: TFdOpenArc;
}

/**
 * Состояние процесса — открытые дуги: топики с `fd-to`, не закрытые ни одним
 * `fd-reply` (внутри файла). Закрытие — по адресу топика (`L1#L2#L3`).
 */
/** Индекс последнего рулевого ISSUE от HUMAN (`HUMAN.*` в `fd-from`) или -1, если нет.
 * Рулевой ISSUE перебивает всё, что было ДО него: и старые открытые дуги, и выданный ранее vault. */
function steeringCutoff(content: TFdContent): number {
  let steerAt = -1;
  content.itemList.forEach((item, i) => {
    const l1 = item.topic.level1;
    if (l1 === null || l1.title !== 'ISSUE' || item.topic.level2 !== null) return;
    const from = item.topic.inlineList.filter((f) => f.param === 'fd-from').flatMap((f) => f.valueList);
    if (from.some((r) => roleCovers('HUMAN', r))) steerAt = i;
  });
  return steerAt;
}

export function openArcs(content: TFdContent): TFdOpenArc[] {
  // Рулевой ISSUE от HUMAN перебивает старые открытые дуги: всё ДО него не актуально.
  const steerAt = steeringCutoff(content);

  // Все fd-reply: адрес → список fd-from ответивших (кто закрывает дугу).
  const replies = new Map<string, string[]>();
  for (const item of content.itemList) {
    const from = item.topic.inlineList.filter((f) => f.param === 'fd-from').flatMap((f) => f.valueList);
    for (const f of item.topic.inlineList) {
      if (f.param !== 'fd-reply') continue;
      for (const v of f.valueList) {
        for (const raw of extractLinks(v)) {
          const p = parseAddr(raw);
          if (p !== null && p.filePath === '') {
            const addr = p.parts.join('#');
            const arr = replies.get(addr) ?? [];
            arr.push(...from);
            replies.set(addr, arr);
          }
        }
      }
    }
  }
  const arcs: TFdOpenArc[] = [];
  content.itemList.forEach((item, i) => {
    if (i < steerAt) return; // перебито рулевым ISSUE от HUMAN
    const to = item.topic.inlineList.filter((f) => f.param === 'fd-to').flatMap((f) => f.valueList);
    if (to.length === 0) return;
    const addr = topicAddr(item.topic);
    if (addr === '') return;
    // Закрыта, только если ответил кто-то из адресатов (адресат покрывает ответившего).
    const replyFrom = replies.get(addr) ?? [];
    const answered = to.some((t) => replyFrom.some((rf) => roleCovers(t, rf)));
    if (answered) return;
    const from = item.topic.inlineList.filter((f) => f.param === 'fd-from').flatMap((f) => f.valueList);
    arcs.push({ addr, from, to });
  });
  return arcs;
}

/** Рекомендуемый L1-раздел ответа по типу источника и адресатам. */
function sectionFor(arc: TFdOpenArc): string | null {
  const l1 = arc.addr.split('#')[0].split(' ')[0];
  switch (l1) {
    case 'ISSUE':
      if (arc.to.some((r) => roleCovers('AI.CODER', r))) return 'CODE';
      if (arc.to.some((r) => roleCovers('AI.REVIEWER', r))) return 'REVIEW';
      return null; // AI.ANALYST: аналитик сам решает (QUESTIONS или передача ISSUE)
    case 'CODE':
    case 'FIX':
      return 'REVIEW';
    case 'REVIEW':
      return 'FIX';
    case 'QUESTIONS':
      return 'ANSWERS';
    default:
      return null;
  }
}

/**
 * Следующий ход: среди открытых дуг HUMAN-дуги приоритетнее (гибридный гейт —
 * пока человек не ответил, AI не приступает), иначе первая AI-дуга по порядку.
 * `null` — открытых ожиданий нет (таск завершён или затор).
 */
export function nextStep(content: TFdContent): TFdNextStep | null {
  if (isCrashed(content)) return null; // CRASH — терминальный маркер аварии, ход не даём
  const arcs = openArcs(content);
  if (arcs.length === 0) return null;
  const human = arcs.filter((a) => a.to.some((r) => roleCovers('HUMAN', r)));
  const chosen = (human.length > 0 ? human : arcs)[0];
  return { roles: chosen.to, section: sectionFor(chosen), arc: chosen };
}

/**
 * Нужен ли гейт: `## Q` первым в следующем `REVIEW`. Срабатывает, когда число
 * уже состоявшихся REVIEW-итераций достигло `spec.reviewLimit` (следующий REVIEW
 * превысит порог). Без `reviewLimit` гейт выключен.
 */
export function gateDue(content: TFdContent, spec: TFdSpecConfig): boolean {
  if (spec.reviewLimit === undefined) return false;
  return reviewFixIterations(content) >= spec.reviewLimit;
}

/** Поручение роли: оси исполнения + контекст + vault + открытые дуги к этой роли. */
export interface TFdRoleBrief {
  /** Роль (как запрошена). */
  role: string;
  /** Резолв осей с наследованием `INSTANCE`→`FUNC`. */
  spec: TFdRoleSpec;
  /** SPEC-биндинги (`context`) — обязательный минимум контекста. */
  context: string[];
  /** Файлы vault из `ISSUE`, адресованных роли (`fd-vault`). */
  vault: string[];
  /** Открытые дуги, адресованные этой роли (адресат покрывает роль). */
  arcs: TFdOpenArc[];
}

/** Собрать поручение роли: оси, SPEC-биндинги, `fd-vault`, её открытые дуги. */
export function roleBrief(spec: TFdSpecConfig, role: string, content: TFdContent): TFdRoleBrief {
  const roleSpec = resolveRole(spec, role);
  const arcs = openArcs(content).filter((a) => a.to.some((r) => roleCovers(r, role)));
  // vault из ISSUE до рулевого ISSUE перебит так же, как и дуги: не виден последующим ролям.
  const steerAt = steeringCutoff(content);
  const vault: string[] = [];
  content.itemList.forEach((item, i) => {
    if (i < steerAt) return;
    const l1 = item.topic.level1;
    if (l1 === null || l1.title !== 'ISSUE' || item.topic.level2 !== null) return;
    const to = item.topic.inlineList.filter((f) => f.param === 'fd-to').flatMap((f) => f.valueList);
    if (!to.some((r) => roleCovers(r, role))) return;
    for (const f of item.topic.inlineList) {
      if (f.param === 'fd-vault') vault.push(...f.valueList);
    }
  });
  return { role, spec: roleSpec, context: roleSpec.context ?? [], vault, arcs };
}
