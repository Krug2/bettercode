export interface PendingUserInputQuestion {
  id: string
  multiSelect?: boolean
}

export interface PendingUserInputDraftAnswer {
  selectedOptionLabels?: string[]
  customAnswer?: string
}

export interface PendingUserInputProgress<
  TQuestion extends PendingUserInputQuestion,
> {
  questionIndex: number
  activeQuestion: TQuestion | null
  activeDraft: PendingUserInputDraftAnswer | undefined
  selectedOptionLabels: string[]
  customAnswer: string
  resolvedAnswer: string | string[] | null
  usingCustomAnswer: boolean
  answeredQuestionCount: number
  isLastQuestion: boolean
  isComplete: boolean
  canAdvance: boolean
}

function normalizeDraftAnswer(value: string | undefined): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

function normalizeSelectedOptionLabels(value: string[] | undefined): string[] {
  const choices = new Set<string>()
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const label = normalizeDraftAnswer(candidate)
      if (label) choices.add(label)
    }
  }
  return [...choices]
}

function answerState(question: PendingUserInputQuestion, draft?: PendingUserInputDraftAnswer) {
  const choices = normalizeSelectedOptionLabels(draft?.selectedOptionLabels)
  const custom = normalizeDraftAnswer(draft?.customAnswer)
  const answer = custom ?? (choices.length ? question.multiSelect ? choices : choices[0]! : null)
  return { question, draft, choices, answer }
}

function questionStates(
  questions: ReadonlyArray<PendingUserInputQuestion>,
  drafts: Record<string, PendingUserInputDraftAnswer>,
) {
  return questions.map(question => answerState(question, drafts[question.id]))
}

export function resolvePendingUserInputAnswer(
  question: PendingUserInputQuestion,
  draft: PendingUserInputDraftAnswer | undefined,
): string | string[] | null {
  return answerState(question, draft).answer
}

export function setPendingUserInputCustomAnswer(
  draft: PendingUserInputDraftAnswer | undefined,
  customAnswer: string,
): PendingUserInputDraftAnswer {
  const result: PendingUserInputDraftAnswer = { customAnswer }
  if (!customAnswer.trim()) {
    const choices = normalizeSelectedOptionLabels(draft?.selectedOptionLabels)
    if (choices.length) result.selectedOptionLabels = choices
  }
  return result
}

export function togglePendingUserInputOptionSelection(
  question: PendingUserInputQuestion,
  draft: PendingUserInputDraftAnswer | undefined,
  optionLabel: string,
): PendingUserInputDraftAnswer {
  const choices = new Set(question.multiSelect ? normalizeSelectedOptionLabels(draft?.selectedOptionLabels) : [])
  if (!question.multiSelect || !choices.delete(optionLabel)) choices.add(optionLabel)
  const result: PendingUserInputDraftAnswer = { customAnswer: "" }
  if (choices.size) result.selectedOptionLabels = [...choices]
  return result
}

export function buildPendingUserInputAnswers<TQuestion extends PendingUserInputQuestion>(
  questions: ReadonlyArray<TQuestion>,
  draftAnswers: Record<string, PendingUserInputDraftAnswer>,
): Record<string, string | string[]> | null {
  const states = questionStates(questions, draftAnswers)
  if (states.some(state => state.answer === null)) return null
  return Object.fromEntries(states.map(state => [state.question.id, state.answer!]))
}

export function countAnsweredPendingUserInputQuestions<TQuestion extends PendingUserInputQuestion>(
  questions: ReadonlyArray<TQuestion>,
  draftAnswers: Record<string, PendingUserInputDraftAnswer>,
): number {
  return questionStates(questions, draftAnswers).filter(state => state.answer !== null).length
}

export function findFirstUnansweredPendingUserInputQuestionIndex<TQuestion extends PendingUserInputQuestion>(
  questions: ReadonlyArray<TQuestion>,
  draftAnswers: Record<string, PendingUserInputDraftAnswer>,
): number {
  const first = questionStates(questions, draftAnswers).findIndex(state => state.answer === null)
  return first < 0 ? Math.max(0, questions.length - 1) : first
}

export function derivePendingUserInputProgress<TQuestion extends PendingUserInputQuestion>(
  questions: ReadonlyArray<TQuestion>,
  draftAnswers: Record<string, PendingUserInputDraftAnswer>,
  questionIndex: number,
): PendingUserInputProgress<TQuestion> {
  // One evaluation per question keeps completion and the active answer consistent.
  const states = questionStates(questions, draftAnswers)
  const last = Math.max(0, states.length - 1)
  const index = states.length ? Math.min(last, Math.max(0, questionIndex)) : 0
  const active = states[index]
  const resolvedAnswer = active?.answer ?? null
  const answered = states.filter(state => state.answer !== null).length
  const customAnswer = active?.draft?.customAnswer ?? ""
  return {
    activeQuestion: questions[index] ?? null,
    activeDraft: active?.draft,
    questionIndex: index,
    customAnswer,
    selectedOptionLabels: active?.choices ?? [],
    resolvedAnswer,
    answeredQuestionCount: answered,
    usingCustomAnswer: Boolean(customAnswer.trim()),
    canAdvance: resolvedAnswer !== null,
    isLastQuestion: states.length === 0 || index >= last,
    isComplete: answered === states.length,
  }
}
