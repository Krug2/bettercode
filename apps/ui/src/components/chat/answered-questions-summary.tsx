import { CheckIcon, ChevronDownIcon } from "lucide-react"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"

/**
 * Collapsed summary of the Q&A pairs produced when a user answers the
 * assistant's batch of questions via {@link PendingQuestionsPanel}.
 *
 * Rendered in place of the user message content (which would otherwise
 * just be a count like "Answered 3 questions"), this shows the actual
 * question → answer pairs once expanded so the user can reread what
 * they told the assistant.
 */
export function AnsweredQuestionsSummary({
  questions,
}: {
  questions: { question: string; answer: string }[]
}) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="flex items-center gap-2 text-sm text-foreground hover:text-foreground/80">
        <CheckIcon className="size-3.5 text-primary" />
        <span className="font-medium">
          Answered {questions.length} question
          {questions.length > 1 ? "s" : ""}
        </span>
        <ChevronDownIcon className="size-3.5 text-muted-foreground" />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-1.5 text-xs">
        {questions.map((qa, i) => (
          <div key={i} className="flex gap-2">
            <span className="shrink-0 text-muted-foreground">
              {qa.question}
            </span>
            <span className="font-medium">{qa.answer}</span>
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}
